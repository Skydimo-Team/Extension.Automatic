import type { SchedulerStatePayload, ScopeRef } from './types.ts'

export function normalizeSkippedActions(value: unknown): SchedulerStatePayload['lastSkipped'] {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const raw = row.scope && typeof row.scope === 'object' ? row.scope as Record<string, unknown> : {}
    const scope: ScopeRef | undefined = typeof raw.port === 'string' && raw.port.length > 0
      ? { port: raw.port, output_id: typeof raw.output_id === 'string' ? raw.output_id : undefined,
          segment_id: typeof raw.segment_id === 'string' ? raw.segment_id : undefined }
      : undefined
    return { scope, reason: typeof row.reason === 'string' ? row.reason : 'unknown' }
  })
}

export function skippedReasonKey(reason: string) {
  switch (reason) {
    case 'manual_override': return 'skippedManual'
    case 'calibration': return 'skippedCalibration'
    case 'preview': return 'skippedPreview'
    case 'busy': return 'skippedBusy'
    case 'linked_control': return 'skippedLinked'
    case 'offline': return 'skippedOffline'
    default: return 'skippedOther'
  }
}

export function matchingMutation(
  pending: { action: string; requestId: string } | null,
  result: { action: string; requestId?: string },
): boolean {
  return pending !== null && result.action === pending.action && result.requestId === pending.requestId
}

export function isConfigSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Record<string, unknown>
  return typeof config.enabled === 'boolean' && Array.isArray(config.rules)
    && !!config.baseline && typeof config.baseline === 'object'
    && Array.isArray((config.baseline as Record<string, unknown>).actions)
}
