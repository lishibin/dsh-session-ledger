import Schema from '@deepseek-ai/schemastery'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { createSessionLedger } from './session-ledger.mjs'
import { createSessionLedgerConfirmationService } from './confirmation.mjs'
import { sessionLedgerDomainSpec } from './domain-spec.mjs'
import { createStorageDomainAdapter } from './storage-domain-adapter.mjs'
import { createHarnessSessionQueryAdapter } from './session-query-adapter.mjs'

export const name = 'dsh-session-ledger'
export const inject = ['sessionQuery', 'storageDomain', 'userQuestions']

export const Config = Schema.object({
  confirmationSecret: Schema.string().required(),
  candidateTtlMs: Schema.number().default(24 * 60 * 60 * 1_000),
})

/**
 * Mount the durable domain and expose ctx.sessionLedger.
 *
 * This module is loaded by a Harness profile. The official peer packages are
 * intentionally resolved by the host profile rather than bundled here.
 */
export async function apply(ctx, config) {
  const domain = await ctx.storageDomain.open(sessionLedgerDomainSpec)
  const store = createStorageDomainAdapter(domain)
  const sessionQuery = createHarnessSessionQueryAdapter(ctx.sessionQuery, { extractText: extractSessionEventText })
  const ledger = createSessionLedger({
    store,
    sessionQuery,
    confirmationSecret: config.confirmationSecret,
    candidateTtlMs: config.candidateTtlMs,
  })
  const confirmation = createSessionLedgerConfirmationService({ ledger, userQuestions: ctx.userQuestions })
  ctx.provide('sessionLedger', ledger)
  ctx.provide('sessionLedgerConfirmation', confirmation)
  ctx.effect(() => async () => {
    await domain.close()
  })
}
