import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHarnessSessionQueryAdapter } from '../src/session-query-adapter.mjs'

test('Harness adapter scopes official SessionRecord shapes by cwd', async () => {
  const headers = [
    { id: 'session-a', cwd: '/repo/a', createdAt: 1, version: 0 },
    { id: 'session-b', cwd: '/repo/b', createdAt: 2, version: 0 },
  ]
  let searchRequest
  const official = {
    async listSessions() {
      return headers.map((header) => ({ header, live: false, persisted: true }))
    },
    async searchSessions(request) {
      searchRequest = request
      return {
        items: [{
          header: headers[0],
          live: false,
          persisted: true,
          bestMatch: { sessionId: 'session-a', seq: 4, time: 1000, snippet: 'rollback' },
        }],
      }
    },
    async readEvent({ sessionId, seq }) {
      return {
        session: headers.find((header) => header.id === sessionId),
        target: { seq, time: 1000, data: { text: 'rollback to previous image' } },
        events: [],
      }
    },
  }
  const adapter = createHarnessSessionQueryAdapter(official, {
    extractText: (event) => event.data.text,
  })
  const page = await adapter.searchSessions({ query: 'rollback', workspaceId: '/repo/a', limit: 10 })
  assert.equal(page.items[0].workspaceId, '/repo/a')
  assert.equal(page.items[0].eventSeq, 4)
  assert.deepEqual(searchRequest.sessionFilters, [{ kind: 'id', values: ['session-a'] }])
  const event = await adapter.readEvent({ sessionId: 'session-a', seq: 4, workspaceId: '/repo/a' })
  assert.equal(event.eventTime, '1970-01-01T00:00:01.000Z')
  assert.equal(event.text, 'rollback to previous image')
  assert.equal(await adapter.readEvent({ sessionId: 'session-a', seq: 4, workspaceId: '/repo/b' }), undefined)
})

test('Harness adapter reports degraded health after a stale cursor', async () => {
  const official = {
    async listSessions() {
      return [{ header: { id: 'session-a', cwd: '/repo/a' } }]
    },
    async searchSessions({ cursor }) {
      if (cursor) {
        const error = new Error('session-search cursor is stale')
        error.code = 'SESSION_QUERY_STALE_CURSOR'
        throw error
      }
      return {
        items: [{
          header: { id: 'session-a', cwd: '/repo/a' },
          bestMatch: { seq: 1, time: 1000, snippet: 'rollback' },
        }],
        nextCursor: 'cursor-1',
      }
    },
    async readEvent() { return undefined },
  }
  const adapter = createHarnessSessionQueryAdapter(official)
  const page = await adapter.searchSessions({ query: 'rollback', workspaceId: '/repo/a' })
  assert.equal(page.nextCursor, 'cursor-1')
  await assert.rejects(
    adapter.searchSessions({ query: 'rollback', workspaceId: '/repo/a', cursor: page.nextCursor }),
    (error) => error.code === 'SESSION_QUERY_STALE_CURSOR',
  )
  assert.deepEqual(await adapter.health(), {
    status: 'degraded',
    backend: 'ctx.sessionQuery',
    workspaceScope: 'cwd',
    code: 'SESSION_QUERY_STALE_CURSOR',
    reason: 'session-search cursor is stale',
  })
})
