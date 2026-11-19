import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function hmacSha256(secret, value) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}

export function canonicalEvidence(evidence) {
  return evidence
    .map((item) => {
      const canonical = {
        workspaceId: item.workspaceId,
        sessionId: item.sessionId,
        eventSeq: item.eventSeq,
        eventTime: item.eventTime,
        sourceKind: item.sourceKind,
        contentHash: item.contentHash,
      }
      if (item.sourceGeneration !== undefined) canonical.sourceGeneration = item.sourceGeneration
      if (item.snippet !== undefined) canonical.snippet = item.snippet
      return canonical
    })
    .sort((a, b) => `${a.sessionId}:${a.eventSeq}`.localeCompare(`${b.sessionId}:${b.eventSeq}`))
}

export function evidenceHash(evidence) {
  return sha256(JSON.stringify(canonicalEvidence(evidence)))
}
