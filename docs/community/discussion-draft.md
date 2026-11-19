# Discussion draft

## Title

`[Proposal] Ticket-scoped context ledger for dsh-superagent`

## Problem

Agents can search historical sessions, but a useful fact is not yet a durable, provenance-aware memory object. Rebuilding a large history after restart also makes it difficult to explain where a saved memory came from or whether the source changed before confirmation.

## Proposal

`dsh-session-ledger` adds a Host-side ledger on top of the existing Harness seams:

1. `ctx.sessionQuery` finds evidence and reads the exact source event;
2. a candidate stores workspace, session, sequence, timestamp, snippet and content hash;
3. `ctx.userQuestions.ask()` asks the user whether to save the proposed memory;
4. only the user-approved HMAC-bound confirmation can promote it through `ctx.storageDomain`;
5. revoke, delete, source changes and degraded query health remain auditable.

The first implementation deliberately does not replace Session Query, add vector search, automatically promote memories, or inject unconfirmed text into prompts.

## Validation

- 15 automated tests pass;
- real `session_ledger` Domain data survives close and reopen;
- missing storage backends and stale query cursors fail closed;
- `dsh@0.2.2-rc.5` installs the plugin and a real profile Host stays up in smoke testing;
- the 100,000-event reference benchmark scans zero events on restart and 1,000 events for a 1,000-event append.

The included benchmark is a reference token-index baseline, not an official SQLite provider claim. On the test machine, reference restart loading took 1.37 seconds, so the one-second target remains open.

## Questions for maintainers

- Is `ctx.userQuestions` the preferred stable seam for plugin-owned approval cards?
- Should workspace scoping move from `SessionHeader.cwd` to a workspace registry service?
- Is there a supported provider diagnostic for index generation, lag and rebuild state?
- Would a ticket-scoped context ledger be useful as an experimental package or as a subsystem contribution?

## Reproduction

```bash
npm test
npm run bench:m4
export DSH_SESSION_LEDGER_SECRET="local-only-secret"
dsh plugin --profile demo add /absolute/path/to/dsh-session-ledger
dsh --profile demo --dump-config
```
