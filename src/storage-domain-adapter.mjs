import { LedgerError } from './errors.mjs'

const tableNames = new Set(['candidates', 'memories', 'audit'])

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function getTable(domain, name) {
  if (!tableNames.has(name)) throw new LedgerError('invalid_storage_table', `unknown ledger table: ${name}`)
  return domain.table(name)
}

/** Adapt an opened ctx.storageDomain Domain to the core LedgerStore contract. */
export function createStorageDomainAdapter(domain) {
  if (!domain || typeof domain.table !== 'function') {
    throw new LedgerError('invalid_storage_domain', 'an opened storage domain is required')
  }
  return {
    async get(table, key) {
      return clone(getTable(domain, table).get(String(key)))
    },
    async put(table, key, value) {
      await getTable(domain, table).put(String(key), clone(value))
      return clone(value)
    },
    async delete(table, key) {
      return getTable(domain, table).delete(String(key))
    },
    async list(table) {
      return [...getTable(domain, table).entries()].map(([, value]) => clone(value))
    },
    async appendAudit(entry) {
      await getTable(domain, 'audit').put(String(entry.id), clone(entry))
    },
    async health() {
      return { status: 'ready', backend: 'ctx.storageDomain', domain: domain.name }
    },
  }
}
