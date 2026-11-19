import { LedgerError } from './errors.mjs'

const saveLabel = 'Save as long-term memory'
const dismissLabel = 'Do not save'

function confirmationDetail(candidate) {
  const sources = candidate.evidence.map((item, index) => {
    const when = item.eventTime ? ` (${item.eventTime})` : ''
    return `${index + 1}. ${item.sessionId}:${item.eventSeq}${when}\n   ${item.snippet}`
  }).join('\n')
  return [
    `Proposed memory:\n${candidate.proposedText}`,
    `Sources:\n${sources}`,
    `This decision is scoped to workspace: ${candidate.workspaceId}`,
  ].join('\n\n')
}

function selectedAnswer(answer, questionId) {
  if (!answer || !Array.isArray(answer.answers) || answer.answers.length !== 1) {
    throw new LedgerError('invalid_confirmation_answer', 'confirmation answer must contain exactly one answer')
  }
  const item = answer.answers[0]
  if (item?.id !== questionId || !Array.isArray(item.selected) || item.selected.length !== 1) {
    throw new LedgerError('invalid_confirmation_answer', 'confirmation answer must select exactly one offered option')
  }
  if (![saveLabel, dismissLabel].includes(item.selected[0])) {
    throw new LedgerError('invalid_confirmation_answer', 'confirmation answer selected an unknown option')
  }
  return item.selected[0]
}

/** Bridge a candidate into Harness's UI-independent user-questions seam. */
export function createSessionLedgerConfirmationService({ ledger, userQuestions }) {
  if (!ledger || typeof ledger.issueConfirmation !== 'function' || typeof ledger.promote !== 'function') {
    throw new LedgerError('invalid_ledger', 'ledger confirmation service requires a SessionLedger')
  }
  return {
    async request({ candidateId, kind = 'other', agent, signal }) {
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        throw new LedgerError('user_confirmation_unavailable', 'ctx.userQuestions is not available')
      }
      const issued = await ledger.issueConfirmation(candidateId)
      const questionId = `session-ledger:${candidateId}`
      const answer = await userQuestions.ask({
        questions: [{
          id: questionId,
          header: 'Long-term memory',
          question: 'Save this as long-term memory?',
          detail: confirmationDetail(issued.candidate),
          options: [
            { label: saveLabel, description: 'Keep the proposed memory and its source references.' },
            { label: dismissLabel, description: 'Discard this candidate without saving it.' },
          ],
          intent: {
            kind: 'approval',
            approve: saveLabel,
            reject: dismissLabel,
            subject: { name: 'dsh-session-ledger' },
          },
        }],
        agent,
        signal,
      })
      const selected = selectedAnswer(answer, questionId)
      if (selected === dismissLabel) {
        const candidate = await ledger.dismiss(candidateId)
        return { status: 'dismissed', candidate }
      }
      const memory = await ledger.promote(candidateId, issued.token, { kind })
      return { status: 'promoted', candidate: await ledger.getCandidate(candidateId), memory }
    },
  }
}

export { dismissLabel, saveLabel }
