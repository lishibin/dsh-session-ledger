import { LedgerError } from './errors.mjs'

export const candidateTransitions = Object.freeze({
  discovered: new Set(['presented', 'dismissed', 'expired']),
  presented: new Set(['confirmed', 'dismissed', 'expired']),
  confirmed: new Set(['promoted', 'expired']),
  promoted: new Set(),
  dismissed: new Set(),
  expired: new Set(),
})

export function transitionCandidate(candidate, nextState) {
  if (candidate.state === nextState) return candidate
  const allowed = candidateTransitions[candidate.state]
  if (!allowed?.has(nextState)) {
    throw new LedgerError(
      'invalid_state_transition',
      `cannot transition candidate ${candidate.id} from ${candidate.state} to ${nextState}`,
      { candidateId: candidate.id, from: candidate.state, to: nextState },
    )
  }
  return { ...candidate, state: nextState }
}
