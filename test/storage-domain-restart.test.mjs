import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BackendRegistry } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { sha256 } from '../src/hash.mjs'
import { sessionLedgerDomainSpec } from '../src/domain-spec.mjs'
import { createSessionLedger } from '../src/session-ledger.mjs'
import { createStorageDomainAdapter } from '../src/storage-domain-adapter.mjs'

function createSessionQuery() {
  const event = {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    eventSeq: 7,
    eventTime: '2026-01-01T00:00:00.000Z',
    text: 'Keep the previous image available for deployment rollback.',
  }
  return {
    async searchSessions() {
      return [{ ...event }]
    },
    async readEvent() {
      return { ...event }
    },
    async health() {
      return { status: 'ready', backend: 'fixture' }
    },
  }
}

async function openRealDomain(root) {
  const backend = new JsonStorageBackend(root)
  const registry = new BackendRegistry()
  registry.register('json', backend)
  const ctx = {
    storage: { backend: registry },
    emit() {},
    logger: { warn() {} },
  }
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const domain = await facility.open(sessionLedgerDomainSpec)
  return { backend, domain }
}

async function closeRealDomain({ backend, domain }) {
  await domain.close()
  await backend.close()
}

test('real storage domain restores promoted memories after a process restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-ledger-'))
  let first
  let second
  try {
    first = await openRealDomain(root)
    const firstLedger = createSessionLedger({
      store: createStorageDomainAdapter(first.domain),
      sessionQuery: createSessionQuery(),
      confirmationSecret: 'restart-test-secret',
      now: () => Date.parse('2026-02-01T00:00:00.000Z'),
    })
    const evidence = (await firstLedger.searchEvidence({
      workspaceId: 'workspace-a',
      query: 'rollback',
    })).items
    assert.equal(evidence[0].contentHash, sha256('Keep the previous image available for deployment rollback.'))
    const candidate = await firstLedger.createCandidate({
      workspaceId: 'workspace-a',
      proposedText: 'Keep the previous image available for deployment rollback.',
      evidence,
    })
    const confirmation = await firstLedger.issueConfirmation(candidate.id)
    const memory = await firstLedger.promote(candidate.id, confirmation.token, { kind: 'workflow-rule' })
    await closeRealDomain(first)
    first = undefined

    second = await openRealDomain(root)
    const secondLedger = createSessionLedger({
      store: createStorageDomainAdapter(second.domain),
      sessionQuery: createSessionQuery(),
      confirmationSecret: 'restart-test-secret',
      now: () => Date.parse('2026-02-01T00:00:00.000Z'),
    })
    const restored = await secondLedger.listMemories({ workspaceId: 'workspace-a' })
    assert.deepEqual(restored, [memory])
    assert.equal((await secondLedger.health()).status, 'ready')
    assert.equal((await createStorageDomainAdapter(second.domain).list('audit')).length, 3)
  } finally {
    if (first) await closeRealDomain(first)
    if (second) await closeRealDomain(second)
    await rm(root, { recursive: true, force: true })
  }
})
