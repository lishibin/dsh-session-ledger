import { LedgerError } from './errors.mjs'

function workspaceKey(header) {
  return String(header?.cwd ?? 'unscoped')
}

function isoTime(value) {
  return new Date(Number(value)).toISOString()
}

/**
 * Adapt the official ctx.sessionQuery shape to the core's explicit workspace
 * contract. Until workspaceRegistry is part of this plugin, a workspace is the
 * canonical session cwd. The adapter constrains search with session id filters
 * before querying, rather than trusting a result-side field that the official
 * SessionRecord does not expose.
 */
export function createHarnessSessionQueryAdapter(sessionQuery, { extractText = defaultExtractText } = {}) {
  if (!sessionQuery || typeof sessionQuery.searchSessions !== 'function' || typeof sessionQuery.readEvent !== 'function') {
    throw new LedgerError('invalid_session_query', 'ctx.sessionQuery is not available')
  }
  let degraded
  return {
    async searchSessions({ query, limit = 20, workspaceId, cursor }) {
      if (typeof sessionQuery.listSessions !== 'function') {
        throw new LedgerError('session_query_unavailable', 'ctx.sessionQuery.listSessions is required for workspace scoping')
      }
      const records = await sessionQuery.listSessions()
      const sessionIds = records
        .filter((record) => workspaceKey(record.header) === workspaceId)
        .map((record) => record.header.id)
      if (sessionIds.length === 0) return { items: [] }
      let page
      try {
        page = await sessionQuery.searchSessions({
          query,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          sessionFilters: [{ kind: 'id', values: sessionIds }],
        })
      } catch (error) {
        if (['SESSION_QUERY_STALE_CURSOR', 'SESSION_QUERY_INVALID_CURSOR', 'SESSION_QUERY_INDEX_FAILED'].includes(error?.code)) {
          degraded = { code: error.code, reason: error.message }
        }
        throw error
      }
      return {
        items: page.items.map((hit) => ({
          workspaceId: workspaceKey(hit.header),
          sessionId: hit.header.id,
          eventSeq: hit.bestMatch.seq,
          timestamp: isoTime(hit.bestMatch.time),
          snippet: hit.bestMatch.snippet,
        })),
        nextCursor: page.nextCursor,
      }
    },
    async readEvent({ sessionId, seq, workspaceId }) {
      const window = await sessionQuery.readEvent({ sessionId, seq })
      if (!window || workspaceKey(window.session) !== workspaceId) return undefined
      const event = window.target
      return {
        workspaceId,
        sessionId: window.session.id,
        eventSeq: event.seq,
        eventTime: isoTime(event.time),
        text: extractText(event),
      }
    },
    async health() {
      return {
        status: degraded ? 'degraded' : 'ready',
        backend: 'ctx.sessionQuery',
        workspaceScope: 'cwd',
        ...(degraded ?? {}),
      }
    },
  }
}

function defaultExtractText(event) {
  return String(event?.text ?? event?.data?.text ?? '')
}

export { workspaceKey }
