import type { AutomaticConfig, ConditionGroup, ConditionLeaf, RuleConfig, ScopeAction } from './types.ts'
import { cloneData, createEmptyConditionGroup, isConditionGroup } from './types.ts'

export function isEditableCondition(input: unknown): input is ConditionLeaf {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const kind = (input as Record<string, unknown>).kind
  return kind === 'app_running' || kind === 'app_foreground'
    || kind === 'window_title_contains' || kind === 'media_playing' || kind === 'media_source_app'
}

export function createCondition(kind: ConditionLeaf['kind']): ConditionLeaf {
  switch (kind) {
    case 'media_playing': return { kind }
    case 'media_source_app': return { kind, source_app_id: '' }
    case 'window_title_contains': return { kind, value: '' }
    default: return { kind, app_name: '' }
  }
}

export function conditionText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeConditionGroup(input: unknown): ConditionGroup {
  if (input === undefined) return createEmptyConditionGroup()
  if (!isConditionGroup(input)) {
    // A malformed root must not silently become an unconditional empty AND.
    return { logic: 'and', negated: false, items: [cloneData(input)] }
  }
  return {
    ...cloneData(input),
    logic: input.logic === 'or' ? 'or' : 'and',
    negated: input.negated === true,
    items: input.items.map((item) => isConditionGroup(item)
      ? normalizeConditionGroup(item) : cloneData(item)),
  }
}

export function normalizeActions(actions: unknown): ScopeAction[] {
  if (!Array.isArray(actions)) return []
  return actions
    .filter((action) => action && typeof action === 'object')
    .map((action) => {
      const value = action as Partial<ScopeAction>
      return {
        scope:
          value.scope && typeof value.scope === 'object' && typeof value.scope.port === 'string'
            ? value.scope : { port: '' },
        effectId: typeof value.effectId === 'string' ? value.effectId : undefined,
        params:
          value.params && typeof value.params === 'object' && !Array.isArray(value.params)
            ? value.params : {},
        brightness: typeof value.brightness === 'number' ? value.brightness : undefined,
        powerOff: typeof value.powerOff === 'boolean' ? value.powerOff : undefined,
        paused: typeof value.paused === 'boolean' ? value.paused : undefined,
      }
    })
}

export function normalizeConfig(config?: Partial<AutomaticConfig>): AutomaticConfig {
  return {
    enabled: config?.enabled !== false,
    baseline: { actions: normalizeActions(config?.baseline?.actions) },
    rules: Array.isArray(config?.rules)
      ? config.rules
          .filter((rule) => rule && typeof rule === 'object')
          .map((rule, index) => {
            const value = rule as Partial<RuleConfig>
            return {
              id: typeof value.id === 'string' && value.id.length > 0 ? value.id : `rule-${index}`,
              enabled: value.enabled !== false,
              name: typeof value.name === 'string' ? value.name : '',
              conditions: normalizeConditionGroup(value.conditions),
              actions: normalizeActions(value.actions),
            }
          })
      : [],
  }
}
