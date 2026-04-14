export type BridgeStatus = 'disconnected' | 'connecting' | 'connected'

export interface ScopeRef {
  port: string
  output_id?: string
  segment_id?: string
}

export interface OutputCapabilities {
  editable: boolean
}

export interface ScopeModeState {
  selected_effect_id?: string
  effective_effect_id?: string
  effective_params?: Record<string, EffectParamValue>
  selected_is_paused: boolean
  effective_is_paused: boolean
}

export interface ScopeBrightnessState {
  value: number
  effective_value: number
}

export interface ScopePowerState {
  selected_is_off: boolean
  effective_is_off: boolean
}

export interface Segment {
  id: string
  name: string
  mode: ScopeModeState
  brightness: ScopeBrightnessState
  power: ScopePowerState
}

export interface OutputPort {
  id: string
  name: string
  capabilities: OutputCapabilities
  mode: ScopeModeState
  brightness: ScopeBrightnessState
  power: ScopePowerState
  segments: Segment[]
}

export interface Device {
  port: string
  name: string
  manufacturer: string
  model: string
  outputs: OutputPort[]
  mode: ScopeModeState
  brightness: ScopeBrightnessState
  power: ScopePowerState
}

export type EffectParamScalarValue = number | boolean | string
export type MultiColorValue = string[]
export type RangeSliderValue = [number, number]
export type EffectParamValue = EffectParamScalarValue | MultiColorValue | RangeSliderValue

export interface ParamDependency {
  key?: string
  equals?: number
  notEquals?: number
  behavior?: 'hide' | 'disable'
}

interface EffectParamBase {
  key: string
  label: string
  group?: string
  dependency?: ParamDependency
}

export interface SliderParam extends EffectParamBase {
  type: 'slider'
  default: number
  min: number
  max: number
  step: number
}

export interface RangeSliderParam extends EffectParamBase {
  type: 'range-slider'
  default: RangeSliderValue
  min: number
  max: number
  step: number
}

export interface SelectOption {
  label: string
  value: number
}

export interface SelectParam extends EffectParamBase {
  type: 'select'
  default: number
  options: SelectOption[]
}

export interface ToggleParam extends EffectParamBase {
  type: 'toggle'
  default: boolean
}

export interface ColorParam extends EffectParamBase {
  type: 'color'
  default: string
}

export interface MultiColorParam extends EffectParamBase {
  type: 'multi-color'
  default: string[]
  fixedCount?: number
  minCount?: number
  maxCount?: number
}

export type EffectParam =
  | SliderParam
  | RangeSliderParam
  | SelectParam
  | ToggleParam
  | ColorParam
  | MultiColorParam

export interface EffectInfo {
  id: string
  name: string
  description?: string
  group?: string
  params: EffectParam[]
}

export interface ScopeAction {
  scope: ScopeRef
  effectId?: string
  params?: Record<string, EffectParamValue>
  brightness?: number
  powerOff?: boolean
  paused?: boolean
}

export interface ConditionLeaf {
  kind: 'app_running' | 'app_foreground' | 'window_title_contains'
  app_name?: string
  value?: string
}

export interface ConditionGroup {
  logic: 'and' | 'or'
  negated: boolean
  items: Array<ConditionGroup | ConditionLeaf>
}

export interface RuleConfig {
  id: string
  enabled: boolean
  name: string
  conditions: ConditionGroup
  actions: ScopeAction[]
}

export interface AutomaticConfig {
  enabled: boolean
  baseline: {
    actions: ScopeAction[]
  }
  rules: RuleConfig[]
}

export interface SnapshotPayload {
  config: AutomaticConfig
  devices: Device[]
  effects: EffectInfo[]
}

export interface ProcessApplication {
  name: string
  instance_count: number
}

export interface FocusTarget {
  app_name?: string
  window_title?: string
}

export interface SystemStatePayload {
  process: {
    supported: boolean
    apps: ProcessApplication[]
  }
  focus: {
    supported: boolean
    current?: FocusTarget
  }
}

export interface SchedulerRuleState {
  id: string
  name: string
  enabled: boolean
  matched: boolean
  active: boolean
}

export interface SchedulerStatePayload {
  enabled: boolean
  matchedRuleIds: string[]
  activeRuleId?: string
  activeSource: 'none' | 'rule' | 'baseline'
  activeName?: string
  activeActions: ScopeAction[]
  rules: SchedulerRuleState[]
  lastRecomputeAt?: string
  lastAppliedAt?: string
  lastErrors: Array<{
    message: string
    scope?: ScopeRef
  }>
}

export interface ActivityEntry {
  id: string
  timestamp: string
  kind: string
  title: string
  detail?: string
}

export interface SaveResultPayload {
  action: string
  ok: boolean
  config: AutomaticConfig
}

export interface ErrorPayload {
  action: string
  message: string
}

export interface ScopeOption {
  key: string
  label: string
  scope: ScopeRef
}

export type BridgeEvent =
  | { type: 'snapshot'; data: SnapshotPayload }
  | { type: 'system_state'; data: SystemStatePayload }
  | { type: 'scheduler_state'; data: SchedulerStatePayload }
  | { type: 'activity'; data: ActivityEntry[] }
  | { type: 'save_result'; data: SaveResultPayload }
  | { type: 'error'; data: ErrorPayload }

export const EMPTY_CONFIG: AutomaticConfig = {
  enabled: true,
  baseline: {
    actions: [],
  },
  rules: [],
}

export const EMPTY_SNAPSHOT: SnapshotPayload = {
  config: EMPTY_CONFIG,
  devices: [],
  effects: [],
}

export const EMPTY_SYSTEM_STATE: SystemStatePayload = {
  process: {
    supported: false,
    apps: [],
  },
  focus: {
    supported: false,
  },
}

export const EMPTY_SCHEDULER_STATE: SchedulerStatePayload = {
  enabled: true,
  matchedRuleIds: [],
  activeSource: 'none',
  activeActions: [],
  rules: [],
  lastErrors: [],
}

export function cloneData<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

export function createEmptyConditionGroup(): ConditionGroup {
  return {
    logic: 'and',
    negated: false,
    items: [],
  }
}

function createRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function createEmptyRule(): RuleConfig {
  return {
    id: createRuleId(),
    enabled: true,
    name: '',
    conditions: createEmptyConditionGroup(),
    actions: [],
  }
}

export function createEmptyAction(scope?: ScopeRef): ScopeAction {
  return {
    scope: scope ?? { port: '' },
    params: {},
  }
}

export function getEffectDefaults(effect?: EffectInfo) {
  const result: Record<string, EffectParamValue> = {}
  if (!effect) {
    return result
  }

  for (const param of effect.params) {
    result[param.key] = cloneData(param.default)
  }
  return result
}

export function isConditionGroup(
  item: ConditionGroup | ConditionLeaf,
): item is ConditionGroup {
  return 'items' in item
}

export function checkDependency(
  effect: EffectInfo | undefined,
  dependency: ParamDependency | undefined,
  currentValues: Record<string, EffectParamValue>,
) {
  if (!dependency) {
    return { visible: true, disabled: false }
  }

  if (!dependency.key || !effect) {
    return {
      visible: dependency.behavior !== 'hide',
      disabled: dependency.behavior === 'disable',
    }
  }

  const controlling = effect.params.find((param) => param.key === dependency.key)
  if (!controlling) {
    return { visible: true, disabled: false }
  }

  const controllingValue = currentValues[controlling.key] ?? controlling.default
  if (typeof controllingValue !== 'number' && typeof controllingValue !== 'boolean') {
    return { visible: true, disabled: false }
  }

  const numericValue =
    typeof controllingValue === 'boolean'
      ? (controllingValue ? 1 : 0)
      : controllingValue

  let matched = true
  if (
    dependency.equals !== undefined &&
    Math.abs(numericValue - dependency.equals) > Number.EPSILON
  ) {
    matched = false
  }
  if (
    dependency.notEquals !== undefined &&
    Math.abs(numericValue - dependency.notEquals) < Number.EPSILON
  ) {
    matched = false
  }

  if (matched) {
    return { visible: true, disabled: false }
  }

  return {
    visible: dependency.behavior !== 'hide',
    disabled: true,
  }
}
