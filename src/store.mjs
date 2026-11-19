function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

/**
 * Test and local-development adapter for the storage-domain contract.
 * The production adapter will map these operations to ctx.storageDomain.
 */
export class InMemoryLedgerStore {
  #tables = new Map()

  #table(name) {
    let table = this.#tables.get(name)
    if (!table) {
      table = new Map()
      this.#tables.set(name, table)
    }
    return table
  }

  async get(table, key) {
    return clone(this.#table(table).get(key))
  }

  async put(table, key, value) {
    this.#table(table).set(String(key), clone(value))
    return clone(value)
  }

  async delete(table, key) {
    return this.#table(table).delete(String(key))
  }

  async list(table) {
    return [...this.#table(table).values()].map(clone)
  }

  async appendAudit(entry) {
    const key = `${entry.createdAt}:${entry.id}`
    await this.put('audit', key, entry)
  }

  async health() {
    return { status: 'ready', backend: 'memory' }
  }
}
