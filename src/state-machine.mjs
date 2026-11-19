import { LedgerError } from './errors.mjs'

export const candidateTransitions = Object.freeze({
  discovered: new Set(['presented', 'dismissed', 'expired']),
  presented: new Set(['confirmed', 'dismissed', 'expired']),
  confirmed: new Set(['promoted', 'expired']),
  promoted: new Set(),
  dismissed: new Set(),
  expired: new Set(),
})

export const memoryTransitions = Object.freeze({
  active: new Set(['revoked', 'deleted']),
  revoked: new Set(['deleted']),
  deleted: new Set(),
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

export function transitionMemory(memory, nextStatus) {
  if (memory.status === nextStatus) return memory
  const allowed = memoryTransitions[memory.status]
  if (!allowed?.has(nextStatus)) {
    throw new LedgerError(
      'invalid_state_transition',
      `cannot transition memory ${memory.id} from ${memory.status} to ${nextStatus}`,
      { memoryId: memory.id, from: memory.status, to: nextStatus },
    )
  }
  return { ...memory, status: nextStatus }
}
