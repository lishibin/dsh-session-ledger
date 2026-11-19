import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionLedger, InMemoryLedgerStore, LedgerError } from '../src/index.mjs'
import { sha256 } from '../src/hash.mjs'

function createFixture() {
  const events = [
    {
      workspace_id: 'workspace-a', session_id: 'session-a', event_seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      text: 'The deployment rollback rule is to keep the previous image.',
    },
    {
      workspace_id: 'workspace-b', session_id: 'session-b', event_seq: 1,
      timestamp: '2026-01-01T00:01:00.000Z',
      text: 'The deployment rule for another workspace is unrelated.',
    },
  ]
  const sessionQuery = {
    async searchSessions({ query, workspaceId }) {
      return events
        .filter((event) => event.workspace_id === workspaceId && event.text.toLowerCase().includes(query.toLowerCase()))
        .map((event) => ({
          workspace_id: event.workspace_id,
          session_id: event.session_id,
          event_seq: event.event_seq,
        }))
    },
    async readEvent({ sessionId, seq, workspaceId }) {
      return events.find((event) => (
        event.session_id === sessionId && event.event_seq === seq && event.workspace_id === workspaceId
      ))
    },
    async health() {
      return { status: 'ready', backend: 'fixture' }
    },
  }
  let current = Date.parse('2026-02-01T00:00:00.000Z')
  const ledger = createSessionLedger({
    store: new InMemoryLedgerStore(),
    sessionQuery,
    confirmationSecret: 'test-secret',
    now: () => current,
  })
  return { events, sessionQuery, ledger, advance: (ms) => { current += ms } }
}

test('searchEvidence returns authorized provenance', async () => {
  const { ledger } = createFixture()
  const result = await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0], {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    eventSeq: 1,
    eventTime: '2026-01-01T00:00:00.000Z',
    sourceKind: 'session-event',
    snippet: 'The deployment rollback rule is to keep the previous image.',
    contentHash: sha256('The deployment rollback rule is to keep the previous image.'),
  })
})

test('candidate requires confirmation and promotion is idempotent', async () => {
  const { ledger } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({
    workspaceId: 'workspace-a',
    proposedText: 'Use the previous image when deployment rollback is required.',
    evidence,
  })
  await assert.rejects(
    ledger.promote(candidate.id, 'invalid-token'),
    (error) => error instanceof LedgerError && error.code === 'invalid_state',
  )
  const confirmation = await ledger.issueConfirmation(candidate.id)
  const memory = await ledger.promote(candidate.id, confirmation.token, { kind: 'workflow-rule' })
  assert.equal(memory.status, 'active')
  assert.equal(memory.kind, 'workflow-rule')
  const duplicate = await ledger.promote(candidate.id, confirmation.token, { kind: 'workflow-rule' })
  assert.equal(duplicate.id, memory.id)
  assert.equal((await ledger.listMemories({ workspaceId: 'workspace-a' })).length, 1)
})

test('concurrent promotion is serialized and creates one memory', async () => {
  const { ledger } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({
    workspaceId: 'workspace-a',
    proposedText: 'Use the previous image when deployment rollback is required.',
    evidence,
  })
  const confirmation = await ledger.issueConfirmation(candidate.id)
  const [first, second] = await Promise.all([
    ledger.promote(candidate.id, confirmation.token),
    ledger.promote(candidate.id, confirmation.token),
  ])
  assert.equal(first.id, second.id)
  assert.equal((await ledger.listMemories({ workspaceId: 'workspace-a' })).length, 1)
})

test('a newly issued confirmation invalidates the previous token', async () => {
  const { ledger } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({ workspaceId: 'workspace-a', proposedText: 'Keep the previous image.', evidence })
  const first = await ledger.issueConfirmation(candidate.id)
  const second = await ledger.issueConfirmation(candidate.id)
  await assert.rejects(
    ledger.promote(candidate.id, first.token),
    (error) => error instanceof LedgerError && error.code === 'invalid_confirmation',
  )
  const memory = await ledger.promote(candidate.id, second.token)
  assert.equal(memory.status, 'active')
  const promoted = await ledger.getCandidate(candidate.id)
  assert.equal(promoted.confirmation.consumedAt !== undefined, true)
})

test('confirmation cannot be reused after evidence changes', async () => {
  const { ledger, events } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({ workspaceId: 'workspace-a', proposedText: 'Keep the previous image.', evidence })
  const confirmation = await ledger.issueConfirmation(candidate.id)
  events[0].text = 'The deployment rollback rule has changed.'
  await assert.rejects(
    ledger.promote(candidate.id, confirmation.token),
    (error) => error instanceof LedgerError && error.code === 'evidence_changed',
  )
})

test('promotion revalidates source identity, timestamp, and generation', async () => {
  const { ledger, events } = createFixture()
  events[0].source_generation = 'generation-1'
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({ workspaceId: 'workspace-a', proposedText: 'Keep the previous image.', evidence })
  const confirmation = await ledger.issueConfirmation(candidate.id)
  events[0].source_generation = 'generation-2'
  await assert.rejects(
    ledger.promote(candidate.id, confirmation.token),
    (error) => error instanceof LedgerError && error.code === 'evidence_changed',
  )
})

test('expired candidates are persisted as terminal state', async () => {
  const { ledger } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({
    workspaceId: 'workspace-a',
    proposedText: 'Keep the previous image.',
    evidence,
    expiresAt: '2026-01-01T00:00:00.000Z',
  })
  await assert.rejects(
    ledger.issueConfirmation(candidate.id),
    (error) => error instanceof LedgerError && error.code === 'candidate_expired',
  )
  assert.equal((await ledger.getCandidate(candidate.id)).state, 'expired')
})

test('candidate evidence cannot cross workspaces and secrets are redacted', async () => {
  const { ledger } = createFixture()
  await assert.rejects(
    ledger.createCandidate({
      workspaceId: 'workspace-a',
      proposedText: 'password=super-secret keep this rule',
      evidence: [{ workspaceId: 'workspace-b', sessionId: 'session-b', eventSeq: 1, contentHash: 'hash' }],
    }),
    (error) => error instanceof LedgerError && error.code === 'workspace_forbidden',
  )
  const candidate = await ledger.createCandidate({
    workspaceId: 'workspace-a',
    proposedText: 'password=super-secret keep this rule',
    evidence: [{
      workspaceId: 'workspace-a', sessionId: 'session-a', eventSeq: 1,
      eventTime: '2026-01-01T00:00:00.000Z', contentHash: sha256('x'), snippet: 'x',
    }],
  })
  assert.match(candidate.proposedText, /\[REDACTED_SECRET\]/)
})

test('revoke and delete preserve auditable metadata while removing content', async () => {
  const { ledger } = createFixture()
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  const candidate = await ledger.createCandidate({ workspaceId: 'workspace-a', proposedText: 'Rollback safely.', evidence })
  const confirmation = await ledger.issueConfirmation(candidate.id)
  const memory = await ledger.promote(candidate.id, confirmation.token)
  const revoked = await ledger.revoke(memory.id)
  assert.equal(revoked.status, 'revoked')
  const deleted = await ledger.delete(memory.id)
  assert.equal(deleted.status, 'deleted')
  assert.equal(deleted.text, '')
  assert.deepEqual(deleted.evidence, [])
  assert.equal((await ledger.listMemories({ workspaceId: 'workspace-a' })).length, 0)
  assert.equal((await ledger.listMemories({ workspaceId: 'workspace-a', includeDeleted: true })).length, 1)
  await assert.rejects(
    ledger.revoke(memory.id),
    (error) => error instanceof LedgerError && error.code === 'invalid_state',
  )
})

test('health reports storage and query readiness', async () => {
  const { ledger } = createFixture()
  const health = await ledger.health()
  assert.equal(health.status, 'ready')
  assert.equal(health.sessionQuery.backend, 'fixture')
})

test('search refuses an unresolvable source instead of creating unverifiable evidence', async () => {
  const { ledger, sessionQuery } = createFixture()
  const originalReadEvent = sessionQuery.readEvent
  sessionQuery.readEvent = async () => undefined
  await assert.rejects(
    ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' }),
    (error) => error instanceof LedgerError && error.code === 'source_unavailable',
  )
  sessionQuery.readEvent = originalReadEvent
})

test('search refuses a source event that does not match the hit identity', async () => {
  const { ledger, sessionQuery, events } = createFixture()
  sessionQuery.readEvent = async () => ({ ...events[0], event_seq: 99 })
  await assert.rejects(
    ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' }),
    (error) => error instanceof LedgerError && error.code === 'evidence_changed',
  )
})
