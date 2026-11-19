import { randomUUID } from 'node:crypto'
import { LedgerError } from './errors.mjs'
import { canonicalEvidence, evidenceHash, hmacSha256, safeEqual, sha256 } from './hash.mjs'
import { limitText, redactSensitiveText } from './redact.mjs'
import { transitionCandidate, transitionMemory } from './state-machine.mjs'

const candidateTable = 'candidates'
const memoryTable = 'memories'
const defaultCandidateTtlMs = 24 * 60 * 60 * 1_000
const memoryKinds = new Set(['preference', 'decision', 'project-fact', 'workflow-rule', 'other'])

function nowIso(now) {
  return new Date(now()).toISOString()
}

function asArray(result) {
  if (Array.isArray(result)) return result
  return result?.items ?? result?.results ?? result?.hits ?? []
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function normalizeHit(hit, requestedWorkspaceId) {
  const match = firstDefined(hit.event, hit.match, hit.bestMatch, hit.best_match, {})
  const sessionId = firstDefined(hit.sessionId, hit.session_id, hit.session?.id, match.sessionId, match.session_id)
  const eventSeq = firstDefined(hit.eventSeq, hit.event_seq, match.eventSeq, match.event_seq, match.seq)
  const workspaceId = firstDefined(
    hit.workspaceId,
    hit.workspace_id,
    hit.session?.workspaceId,
    hit.session?.workspace_id,
    requestedWorkspaceId,
  )
  if (!sessionId || !Number.isInteger(Number(eventSeq))) return null
  return { sessionId: String(sessionId), eventSeq: Number(eventSeq), workspaceId: String(workspaceId) }
}

function normalizeEvent(event, fallback) {
  const text = firstDefined(event?.text, event?.content, event?.message, event?.rawText, '')
  return {
    workspaceId: String(firstDefined(event?.workspaceId, event?.workspace_id, fallback.workspaceId)),
    sessionId: String(firstDefined(event?.sessionId, event?.session_id, fallback.sessionId)),
    eventSeq: Number(firstDefined(event?.eventSeq, event?.event_seq, event?.seq, fallback.eventSeq)),
    eventTime: String(firstDefined(event?.eventTime, event?.event_time, event?.timestamp, event?.time, '')),
    sourceGeneration: firstDefined(event?.sourceGeneration, event?.source_generation),
    text: String(text),
  }
}

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LedgerError('invalid_input', `${field} must be a non-empty string`, { field })
  }
}

function assertWorkspace(workspaceId) {
  assertNonEmpty(workspaceId, 'workspaceId')
}

export class SessionLedger {
  #promotionLocks = new Map()

  constructor({ store, sessionQuery, confirmationSecret, now = Date.now, candidateTtlMs = defaultCandidateTtlMs }) {
    if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
      throw new LedgerError('invalid_store', 'store must implement get() and put()')
    }
    if (!sessionQuery || typeof sessionQuery.searchSessions !== 'function' || typeof sessionQuery.readEvent !== 'function') {
      throw new LedgerError('invalid_session_query', 'sessionQuery must implement searchSessions() and readEvent()')
    }
    assertNonEmpty(confirmationSecret, 'confirmationSecret')
    this.store = store
    this.sessionQuery = sessionQuery
    this.confirmationSecret = confirmationSecret
    this.now = now
    this.candidateTtlMs = candidateTtlMs
  }

  async #audit(action, targetId, workspaceId, details = {}) {
    const entry = {
      id: randomUUID(),
      action,
      targetId,
      workspaceId,
      createdAt: nowIso(this.now),
      details,
    }
    if (typeof this.store.appendAudit === 'function') await this.store.appendAudit(entry)
    else await this.store.put('audit', entry.id, entry)
  }

  async searchEvidence({ workspaceId, query, limit = 20 }) {
    assertWorkspace(workspaceId)
    assertNonEmpty(query, 'query')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new LedgerError('invalid_input', 'limit must be an integer between 1 and 100')
    }
    const response = await this.sessionQuery.searchSessions({ query, limit, workspaceId })
    const evidence = []
    for (const rawHit of asArray(response)) {
      const hit = normalizeHit(rawHit, workspaceId)
      if (!hit || hit.workspaceId !== workspaceId) continue
      const rawEvent = await this.sessionQuery.readEvent({ sessionId: hit.sessionId, seq: hit.eventSeq, workspaceId })
      if (!rawEvent) {
        throw new LedgerError('source_unavailable', `event ${hit.sessionId}:${hit.eventSeq} could not be read`, { hit })
      }
      const event = normalizeEvent(rawEvent, hit)
      if (
        event.workspaceId !== workspaceId
        || event.sessionId !== hit.sessionId
        || event.eventSeq !== hit.eventSeq
      ) {
        throw new LedgerError('evidence_changed', `search hit ${hit.sessionId}:${hit.eventSeq} resolved to a different event`, { hit })
      }
      const contentHash = sha256(event.text)
      evidence.push({
        workspaceId,
        sessionId: event.sessionId,
        eventSeq: event.eventSeq,
        eventTime: event.eventTime,
        sourceKind: 'session-event',
        ...(event.sourceGeneration ? { sourceGeneration: event.sourceGeneration } : {}),
        snippet: limitText(event.text),
        contentHash,
      })
      if (evidence.length >= limit) break
    }
    return { query, workspaceId, items: evidence }
  }

  async #getCandidate(candidateId) {
    const candidate = await this.store.get(candidateTable, candidateId)
    if (!candidate) throw new LedgerError('not_found', `candidate ${candidateId} was not found`, { candidateId })
    return candidate
  }

  async getCandidate(candidateId) {
    return structuredClone(await this.#getCandidate(candidateId))
  }

  async #assertCandidateNotExpired(candidate) {
    if (Date.parse(candidate.expiresAt) <= this.now() && !['promoted', 'dismissed', 'expired'].includes(candidate.state)) {
      const expired = transitionCandidate(candidate, 'expired')
      await this.store.put(candidateTable, candidate.id, expired)
      await this.#audit('candidate.expired', candidate.id, candidate.workspaceId)
      throw new LedgerError('candidate_expired', `candidate ${candidate.id} has expired`, { candidateId: candidate.id })
    }
  }

  async createCandidate({ workspaceId, proposedText, evidence, expiresAt = undefined }) {
    assertWorkspace(workspaceId)
    assertNonEmpty(proposedText, 'proposedText')
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new LedgerError('invalid_input', 'evidence must contain at least one source')
    }
    const safeText = redactSensitiveText(proposedText).trim()
    const safeEvidence = evidence.map((item) => ({
      workspaceId: item.workspaceId,
      sessionId: item.sessionId,
      eventSeq: item.eventSeq,
      eventTime: item.eventTime,
      sourceKind: item.sourceKind ?? 'session-event',
      ...(item.sourceGeneration ? { sourceGeneration: item.sourceGeneration } : {}),
      snippet: redactSensitiveText(limitText(item.snippet)),
      contentHash: item.contentHash,
    }))
    for (const item of safeEvidence) {
      if (item.workspaceId !== workspaceId) {
        throw new LedgerError('workspace_forbidden', 'candidate evidence crosses workspace boundary')
      }
      if (!item.sessionId || !Number.isInteger(Number(item.eventSeq)) || !item.contentHash) {
        throw new LedgerError('invalid_input', 'each evidence item needs sessionId, eventSeq and contentHash')
      }
    }
    const createdAt = nowIso(this.now)
    const candidate = {
      id: randomUUID(),
      workspaceId,
      state: 'discovered',
      proposedText: safeText,
      proposedTextHash: sha256(safeText),
      evidence: safeEvidence,
      createdAt,
      expiresAt: expiresAt ?? new Date(this.now() + this.candidateTtlMs).toISOString(),
    }
    await this.store.put(candidateTable, candidate.id, candidate)
    await this.#audit('candidate.created', candidate.id, workspaceId, { evidenceCount: safeEvidence.length })
    return structuredClone(candidate)
  }

  async issueConfirmation(candidateId) {
    const candidate = await this.#getCandidate(candidateId)
    await this.#assertCandidateNotExpired(candidate)
    if (!['discovered', 'presented'].includes(candidate.state)) {
      throw new LedgerError('invalid_state', `candidate ${candidateId} is ${candidate.state}`)
    }
    const confirmationId = randomUUID()
    const pendingConfirmation = {
      confirmationId,
      issuedAt: nowIso(this.now),
    }
    const presented = transitionCandidate({ ...candidate, pendingConfirmation }, 'presented')
    await this.store.put(candidateTable, candidateId, presented)
    const payload = {
      v: 1,
      candidateId,
      workspaceId: candidate.workspaceId,
      proposedTextHash: candidate.proposedTextHash,
      evidenceHash: evidenceHash(candidate.evidence),
      confirmationId,
      expiresAt: candidate.expiresAt,
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const token = `${encoded}.${hmacSha256(this.confirmationSecret, encoded)}`
    await this.#audit('candidate.presented', candidateId, candidate.workspaceId)
    return { candidate: structuredClone(presented), token, expiresAt: candidate.expiresAt }
  }

  #decodeConfirmation(token, candidate) {
    if (typeof token !== 'string') throw new LedgerError('invalid_confirmation', 'confirmation token is required')
    const [encoded, signature] = token.split('.')
    if (!encoded || !signature || !safeEqual(signature, hmacSha256(this.confirmationSecret, encoded))) {
      throw new LedgerError('invalid_confirmation', 'confirmation token signature is invalid')
    }
    let payload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw new LedgerError('invalid_confirmation', 'confirmation token payload is invalid')
    }
    const expectedConfirmationId = candidate.pendingConfirmation?.confirmationId ?? candidate.confirmation?.confirmationId
    if (
      payload.v !== 1 || payload.candidateId !== candidate.id || payload.workspaceId !== candidate.workspaceId
      || !expectedConfirmationId || payload.confirmationId !== expectedConfirmationId
      || !safeEqual(payload.proposedTextHash, candidate.proposedTextHash)
      || !safeEqual(payload.evidenceHash, evidenceHash(candidate.evidence))
      || Date.parse(payload.expiresAt) <= this.now()
    ) {
      throw new LedgerError('invalid_confirmation', 'confirmation token does not match current candidate')
    }
    return payload
  }

  async #verifyEvidence(candidate) {
    for (const item of candidate.evidence) {
      const rawEvent = await this.sessionQuery.readEvent({
        sessionId: item.sessionId,
        seq: item.eventSeq,
        workspaceId: candidate.workspaceId,
      })
      if (!rawEvent) {
        throw new LedgerError('source_unavailable', `event ${item.sessionId}:${item.eventSeq} could not be read`, { evidence: item })
      }
      const event = normalizeEvent(rawEvent, item)
      if (event.workspaceId !== candidate.workspaceId) throw new LedgerError('workspace_forbidden', 'evidence is no longer authorized')
      if (event.sessionId !== item.sessionId || event.eventSeq !== Number(item.eventSeq)) {
        throw new LedgerError('evidence_changed', `evidence ${item.sessionId}:${item.eventSeq} no longer identifies the same event`, { evidence: item })
      }
      if (item.eventTime && event.eventTime && event.eventTime !== item.eventTime) {
        throw new LedgerError('evidence_changed', `evidence ${item.sessionId}:${item.eventSeq} timestamp changed`, { evidence: item })
      }
      if (item.sourceGeneration !== undefined && event.sourceGeneration !== item.sourceGeneration) {
        throw new LedgerError('evidence_changed', `evidence ${item.sessionId}:${item.eventSeq} source version changed`, { evidence: item })
      }
      if (!safeEqual(sha256(event.text), item.contentHash)) {
        throw new LedgerError('evidence_changed', `evidence ${item.sessionId}:${item.eventSeq} changed`, { evidence: item })
      }
    }
  }

  async #promote(candidateId, token, { kind = 'other' } = {}) {
    const candidate = await this.#getCandidate(candidateId)
    if (candidate.state === 'promoted') {
      return this.store.get(memoryTable, `memory-${candidate.id}`)
    }
    await this.#assertCandidateNotExpired(candidate)
    if (!['presented', 'confirmed'].includes(candidate.state)) {
      throw new LedgerError('invalid_state', `candidate ${candidateId} is ${candidate.state}`)
    }
    if (!memoryKinds.has(kind)) throw new LedgerError('invalid_input', `unknown memory kind: ${kind}`)
    const confirmationPayload = this.#decodeConfirmation(token, candidate)
    const tokenId = sha256(token).slice(0, 16)
    if (candidate.state === 'confirmed' && candidate.confirmation?.consumedAt) {
      throw new LedgerError('confirmation_replayed', 'confirmation token has already been consumed', { candidateId })
    }
    if (candidate.state === 'confirmed' && candidate.confirmation?.tokenId !== tokenId) {
      throw new LedgerError('invalid_confirmation', 'confirmation token does not match the confirmed candidate')
    }
    await this.#verifyEvidence(candidate)

    const confirmed = candidate.state === 'confirmed' ? candidate : transitionCandidate(candidate, 'confirmed')
    const { pendingConfirmation, ...withoutPendingConfirmation } = confirmed
    const confirmedRecord = {
      ...withoutPendingConfirmation,
      confirmation: {
        tokenId,
        confirmationId: confirmationPayload.confirmationId,
        ...(pendingConfirmation?.issuedAt ? { issuedAt: pendingConfirmation.issuedAt } : {}),
        confirmedAt: nowIso(this.now),
        confirmedTextHash: candidate.proposedTextHash,
      },
    }
    await this.store.put(candidateTable, candidate.id, confirmedRecord)
    const memoryId = `memory-${candidate.id}`
    const existing = await this.store.get(memoryTable, memoryId)
    if (existing) {
      const completed = transitionCandidate({
        ...confirmedRecord,
        confirmation: { ...confirmedRecord.confirmation, consumedAt: existing.promotedAt ?? nowIso(this.now) },
      }, 'promoted')
      await this.store.put(candidateTable, candidate.id, completed)
      return structuredClone(existing)
    }
    const memory = {
      id: memoryId,
      workspaceId: candidate.workspaceId,
      text: candidate.proposedText,
      kind,
      status: 'active',
      sourceCandidateId: candidate.id,
      evidence: canonicalEvidence(candidate.evidence),
      createdAt: nowIso(this.now),
      updatedAt: nowIso(this.now),
      schemaVersion: 1,
    }
    await this.store.put(memoryTable, memory.id, memory)
    await this.store.put(candidateTable, candidate.id, transitionCandidate({
      ...confirmedRecord,
      confirmation: { ...confirmedRecord.confirmation, consumedAt: nowIso(this.now) },
    }, 'promoted'))
    await this.#audit('memory.promoted', memory.id, memory.workspaceId, { candidateId: candidate.id, kind })
    return structuredClone(memory)
  }

  async promote(candidateId, token, options = {}) {
    const previous = this.#promotionLocks.get(candidateId) ?? Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    this.#promotionLocks.set(candidateId, current)
    try {
      await previous
      return await this.#promote(candidateId, token, options)
    } finally {
      release()
      if (this.#promotionLocks.get(candidateId) === current) this.#promotionLocks.delete(candidateId)
    }
  }

  async dismiss(candidateId) {
    const candidate = await this.#getCandidate(candidateId)
    await this.#assertCandidateNotExpired(candidate)
    if (candidate.state === 'dismissed') return structuredClone(candidate)
    if (!['discovered', 'presented'].includes(candidate.state)) {
      throw new LedgerError('invalid_state', `candidate ${candidateId} is ${candidate.state}`)
    }
    const dismissed = transitionCandidate(candidate, 'dismissed')
    await this.store.put(candidateTable, candidateId, dismissed)
    await this.#audit('candidate.dismissed', candidateId, candidate.workspaceId)
    return structuredClone(dismissed)
  }

  async listMemories({ workspaceId, includeRevoked = true, includeDeleted = false } = {}) {
    assertWorkspace(workspaceId)
    const records = typeof this.store.list === 'function' ? await this.store.list(memoryTable) : []
    return records.filter((record) => (
      record.workspaceId === workspaceId
      && (includeDeleted || record.status !== 'deleted')
      && (includeRevoked || record.status !== 'revoked')
    )).map((record) => structuredClone(record))
  }

  async revoke(memoryId) {
    const memory = await this.store.get(memoryTable, memoryId)
    if (!memory) throw new LedgerError('not_found', `memory ${memoryId} was not found`, { memoryId })
    if (memory.status === 'deleted') throw new LedgerError('invalid_state', 'deleted memory cannot be revoked')
    if (memory.status === 'revoked') return memory
    const updated = {
      ...transitionMemory(memory, 'revoked'),
      revokedAt: nowIso(this.now),
      updatedAt: nowIso(this.now),
    }
    await this.store.put(memoryTable, memoryId, updated)
    await this.#audit('memory.revoked', memoryId, memory.workspaceId)
    return structuredClone(updated)
  }

  async delete(memoryId) {
    const memory = await this.store.get(memoryTable, memoryId)
    if (!memory) throw new LedgerError('not_found', `memory ${memoryId} was not found`, { memoryId })
    if (memory.status === 'deleted') return memory
    const updated = {
      ...transitionMemory(memory, 'deleted'),
      status: 'deleted',
      text: '',
      evidence: [],
      deletedAt: nowIso(this.now),
      updatedAt: nowIso(this.now),
    }
    await this.store.put(memoryTable, memoryId, updated)
    await this.#audit('memory.deleted', memoryId, memory.workspaceId)
    return structuredClone(updated)
  }

  async exportMemories({ workspaceId, includeDeleted = false } = {}) {
    const records = await this.listMemories({ workspaceId, includeDeleted })
    return {
      schemaVersion: 1,
      workspaceId,
      exportedAt: nowIso(this.now),
      memories: records,
    }
  }

  async health() {
    const storage = typeof this.store.health === 'function' ? await this.store.health() : { status: 'unknown' }
    const query = typeof this.sessionQuery.health === 'function'
      ? await this.sessionQuery.health()
      : { status: 'unknown', reason: 'sessionQuery health is not exposed by adapter' }
    const status = storage.status === 'ready' && ['ready', 'unknown'].includes(query.status) ? 'ready' : 'degraded'
    return { status, storage, sessionQuery: query }
  }
}

export function createSessionLedger(options) {
  return new SessionLedger(options)
}
