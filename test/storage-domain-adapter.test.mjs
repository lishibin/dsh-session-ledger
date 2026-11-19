import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BackendRegistry } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { sessionLedgerDomainSpec } from '../src/domain-spec.mjs'
import { createStorageDomainAdapter } from '../src/storage-domain-adapter.mjs'

function fakeDomain() {
  const tables = new Map(['candidates', 'memories', 'audit'].map((name) => [name, new Map()]))
  return {
    name: 'session_ledger',
    table(name) {
      const records = tables.get(name)
      return {
        get: (key) => records.get(key),
        entries: () => records.entries(),
        put: async (key, value) => { records.set(key, value) },
        delete: async (key) => records.delete(key),
      }
    },
  }
}

test('storage-domain adapter maps durable table operations', async () => {
  const adapter = createStorageDomainAdapter(fakeDomain())
  await adapter.put('memories', 'memory-1', { id: 'memory-1', text: 'rule' })
  assert.deepEqual(await adapter.get('memories', 'memory-1'), { id: 'memory-1', text: 'rule' })
  assert.deepEqual(await adapter.list('memories'), [{ id: 'memory-1', text: 'rule' }])
  await adapter.appendAudit({ id: 'audit-1', action: 'memory.created' })
  assert.equal((await adapter.list('audit'))[0].id, 'audit-1')
  assert.equal(await adapter.delete('memories', 'memory-1'), true)
  assert.equal(await adapter.get('memories', 'memory-1'), undefined)
})

test('storage domain refuses to open when its routed backend is missing', async () => {
  const ctx = {
    storage: { backend: new BackendRegistry() },
    emit() {},
    logger: { warn() {} },
  }
  const facility = new DomainFacility(ctx, { backend: 'json' })
  await assert.rejects(
    facility.open(sessionLedgerDomainSpec),
    (error) => error.code === 'backend-not-found',
  )
})
