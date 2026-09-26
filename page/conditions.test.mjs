import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conditionText, createCondition, isEditableCondition, normalizeConditionGroup, normalizeConfig,
} from './src/config.ts'
import { cloneData, isConditionGroup } from './src/types.ts'

const opaque = { kind: 'future_condition', logic: 'custom', items: [{ payload: [1, true, null] }], extra: 'preserve' }
const media = [
  { kind: 'media_playing' },
  { kind: 'media_source_app', source_app_id: 'Example.Player_123!App' },
]
const original = {
  enabled: true, baseline: { actions: [] }, rules: [
    { id: 'preserve', name: 'music', enabled: true, conditions: {
      logic: 'and', negated: false, items: [...media, { logic: 'or', negated: true, items: [opaque] }],
    }, actions: [] },
    { id: 'edit', name: 'other', enabled: true, conditions: { logic: 'and', negated: false, items: [] }, actions: [] },
  ],
}
const roundTrip = (value) => normalizeConfig(JSON.parse(JSON.stringify(value)))

test('media and future conditions survive snapshot and save-result normalization', () => {
  const normalized = normalizeConfig(original)
  assert.deepEqual(normalized, original)
  assert.deepEqual(roundTrip(normalized), normalized)
  assert.equal(isConditionGroup(opaque), false)
  assert.equal(isEditableCondition(opaque), false)
  assert.equal(isConditionGroup({ type: 'future', items: [] }), false)
})

test('editing an unrelated rule keeps media and nested opaque data unchanged', () => {
  const draft = cloneData(normalizeConfig(original))
  draft.rules[1].name = 'renamed'
  draft.rules[1].enabled = false
  draft.rules[1].conditions.items.push(createCondition('app_running'))
  assert.deepEqual(roundTrip(draft).rules[0], original.rules[0])
  assert.equal(original.rules[1].name, 'other')
  assert.deepEqual(original.rules[1].conditions.items, [])
})

test('editing baseline and global enable keeps all rule conditions unchanged', () => {
  const draft = normalizeConfig(original)
  draft.baseline.actions = [{ scope: { port: 'fixture' }, brightness: 25 }]
  draft.enabled = false
  assert.deepEqual(roundTrip(draft).rules, original.rules)
})

test('editing media source preserves siblings and never aliases the received snapshot', () => {
  const draft = normalizeConfig(original)
  draft.rules[0].conditions.items[1].source_app_id = 'another.player'
  const saved = roundTrip(draft)
  assert.equal(saved.rules[0].conditions.items[1].source_app_id, 'another.player')
  assert.deepEqual(saved.rules[0].conditions.items[2], original.rules[0].conditions.items[2])
  assert.equal(original.rules[0].conditions.items[1].source_app_id, 'Example.Player_123!App')
})

test('empty, invalid and non-object conditions are retained, never filtered or converted', () => {
  const items = [null, false, 5, 'future', [], {}, { payload: true },
    { kind: 'app_running' }, { kind: 'app_running', app_name: '' },
    { kind: 'app_foreground', app_name: false }, { kind: 'window_title_contains', value: null },
    { kind: 'media_source_app', source_app_id: null }, { kind: 'media_source_app', source_app_id: 42 },
    { logic: 'and' }, { logic: 'xor', items: [] }, { logic: 'and', negated: 'true', items: [] },
  ]
  for (const logic of ['and', 'or']) {
    for (const negated of [true, false]) {
      const group = { logic, negated, items }
      assert.deepEqual(normalizeConditionGroup(group), group)
      assert.deepEqual(normalizeConditionGroup(JSON.parse(JSON.stringify(group))), group)
    }
  }
})

test('malformed roots are preserved as opaque leaves; explicit empty groups stay empty', () => {
  for (const root of [null, false, {}, { logic: 'and' }, opaque]) {
    const normalized = normalizeConditionGroup(root)
    assert.deepEqual(normalized.items, [root])
    assert.deepEqual(normalizeConditionGroup(normalized), normalized)
  }
  assert.deepEqual(normalizeConditionGroup(undefined), { logic: 'and', negated: false, items: [] })
  for (const logic of ['and', 'or']) {
    for (const negated of [true, false]) {
      const empty = { logic, negated, items: [] }
      assert.deepEqual(normalizeConditionGroup(empty), empty)
    }
  }
})

test('new media controls use separate identity fields and guard invalid input without coercion', () => {
  assert.deepEqual(createCondition('media_playing'), { kind: 'media_playing' })
  assert.deepEqual(createCondition('media_source_app'), { kind: 'media_source_app', source_app_id: '' })
  assert.deepEqual(createCondition('app_running'), { kind: 'app_running', app_name: '' })
  assert.deepEqual(createCondition('window_title_contains'), { kind: 'window_title_contains', value: '' })
  for (const condition of [...media, { kind: 'media_source_app', source_app_id: null }]) {
    assert.equal(isEditableCondition(condition), true)
  }
  for (const value of [null, true, 123, {}]) assert.equal(conditionText(value), '')
  assert.equal(conditionText('Exact.Player'), 'Exact.Player')
})
