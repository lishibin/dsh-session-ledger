import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionLedgerConfirmationService, dismissLabel, saveLabel } from '../src/confirmation.mjs'
import { LedgerError } from '../src/errors.mjs'
import { createSessionLedger } from '../src/session-ledger.mjs'
import { InMemoryLedgerStore } from '../src/store.mjs'

function fixture() {
  const event = {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    eventSeq: 3,
    eventTime: '2026-01-01T00:00:00.000Z',
    text: 'The release workflow keeps the previous image for rollback.',
  }
  const sessionQuery = {
    async searchSessions() { return [{ ...event }] },
    async readEvent() { return { ...event } },
  }
  const ledger = createSessionLedger({
    store: new InMemoryLedgerStore(),
    sessionQuery,
    confirmationSecret: 'confirmation-test-secret',
    now: () => Date.parse('2026-02-01T00:00:00.000Z'),
  })
  return { ledger }
}

async function candidateOf(ledger, proposedText = 'Keep the previous image for rollback.') {
  const evidence = (await ledger.searchEvidence({ workspaceId: 'workspace-a', query: 'rollback' })).items
  return ledger.createCandidate({ workspaceId: 'workspace-a', proposedText, evidence })
}

test('confirmation service asks an approval question and promotes only after save', async () => {
  const { ledger } = fixture()
  const candidate = await candidateOf(ledger)
  let request
  const service = createSessionLedgerConfirmationService({
    ledger,
    userQuestions: {
      async ask(value) {
        request = value
        return { answers: [{ id: value.questions[0].id, selected: [saveLabel] }] }
      },
    },
  })

  const result = await service.request({ candidateId: candidate.id, kind: 'workflow-rule' })
  assert.equal(result.status, 'promoted')
  assert.equal(result.memory.kind, 'workflow-rule')
  assert.equal(result.candidate.state, 'promoted')
  assert.equal(result.candidate.confirmation.confirmedTextHash, candidate.proposedTextHash)
  assert.match(result.candidate.confirmation.tokenId, /^[a-f0-9]{16}$/)
  assert.equal(request.questions[0].intent.kind, 'approval')
  assert.deepEqual(request.questions[0].options.map((option) => option.label), [saveLabel, dismissLabel])
  assert.match(request.questions[0].detail, /session-a:3/)
  assert.doesNotMatch(request.questions[0].detail, /confirmation-test-secret/)
})

test('confirmation service dismisses without creating memory and redacts candidate text', async () => {
  const { ledger } = fixture()
  const candidate = await candidateOf(ledger, 'password=do-not-store keep rollback rule')
  let request
  const service = createSessionLedgerConfirmationService({
    ledger,
    userQuestions: {
      async ask(value) {
        request = value
        return { answers: [{ id: value.questions[0].id, selected: [dismissLabel] }] }
      },
    },
  })

  const result = await service.request({ candidateId: candidate.id })
  assert.equal(result.status, 'dismissed')
  assert.equal(result.candidate.state, 'dismissed')
  assert.equal((await ledger.listMemories({ workspaceId: 'workspace-a' })).length, 0)
  assert.match(request.questions[0].detail, /\[REDACTED_SECRET\]/)
  assert.doesNotMatch(request.questions[0].detail, /do-not-store/)
})

test('confirmation service fails closed on missing channel or malformed answer', async () => {
  const { ledger } = fixture()
  const candidate = await candidateOf(ledger)
  const withoutChannel = createSessionLedgerConfirmationService({ ledger })
  await assert.rejects(
    withoutChannel.request({ candidateId: candidate.id }),
    (error) => error instanceof LedgerError && error.code === 'user_confirmation_unavailable',
  )

  const malformed = createSessionLedgerConfirmationService({
    ledger,
    userQuestions: { async ask() { return { answers: [] } } },
  })
  await assert.rejects(
    malformed.request({ candidateId: candidate.id }),
    (error) => error instanceof LedgerError && error.code === 'invalid_confirmation_answer',
  )
  assert.equal((await ledger.getCandidate(candidate.id)).state, 'presented')
})
