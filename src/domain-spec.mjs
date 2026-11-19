import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const evidenceSchema = z.object({
  workspaceId: z.string(),
  sessionId: z.string(),
  eventSeq: z.number().int().nonnegative(),
  eventTime: z.string(),
  sourceKind: z.literal('session-event'),
  sourceGeneration: z.string().optional(),
  snippet: z.string(),
  contentHash: z.string(),
})

const candidateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  state: z.enum(['discovered', 'presented', 'confirmed', 'promoted', 'dismissed', 'expired']),
  proposedText: z.string(),
  proposedTextHash: z.string(),
  evidence: z.array(evidenceSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  pendingConfirmation: z.object({
    confirmationId: z.string(),
    issuedAt: z.string(),
  }).optional(),
  confirmation: z.object({
    tokenId: z.string(),
    confirmationId: z.string().optional(),
    issuedAt: z.string().optional(),
    confirmedAt: z.string(),
    confirmedTextHash: z.string(),
    consumedAt: z.string().optional(),
  }).optional(),
})

const memorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  text: z.string(),
  kind: z.enum(['preference', 'decision', 'project-fact', 'workflow-rule', 'other']),
  status: z.enum(['active', 'revoked', 'deleted']),
  sourceCandidateId: z.string(),
  evidence: z.array(evidenceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().optional(),
  deletedAt: z.string().optional(),
  schemaVersion: z.literal(1),
})

const auditSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetId: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
  details: z.record(z.string(), z.unknown()),
})

/** Durable schema owned by the plugin; it contains no session events. */
export const sessionLedgerDomainSpec = defineDomain({
  // Harness storage unit names are filesystem-safe identifiers; the npm
  // package keeps its hyphenated name, while the durable domain uses `_`.
  name: 'session_ledger',
  version: 1,
  tables: {
    candidates: domainTable(candidateSchema),
    memories: domainTable(memorySchema),
    audit: domainTable(auditSchema),
  },
})
