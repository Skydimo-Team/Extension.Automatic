import assert from 'node:assert/strict'
import test from 'node:test'
import { isConfigSnapshot, matchingMutation, normalizeSkippedActions, skippedReasonKey } from './src/scheduler.ts'

test('missing control status is unknown, not an empty successful report', () => {
  for (const value of [undefined, null, false, {}, '']) assert.equal(normalizeSkippedActions(value), undefined)
  assert.deepEqual(normalizeSkippedActions([]), [])
})

test('unknown or malformed skipped rows are preserved and displayed generically', () => {
  const value = [{ scope: { port: 'mock', output_id: 'a', segment_id: 'b' }, reason: 'manual_override' },
    { scope: { port: 'other' }, reason: 'future_reason' }, null, { reason: 'unchanged' }]
  const normalized = normalizeSkippedActions(value)
  assert.equal(normalized.length, 4)
  assert.deepEqual(normalized[0], value[0])
  assert.equal(normalized[1].reason, 'future_reason')
  assert.deepEqual(normalized[2], { scope: undefined, reason: 'unknown' })
  assert.equal(normalized.filter(row => row.reason !== 'unchanged').length, 3)
  assert.equal(skippedReasonKey('future_reason'), 'skippedOther')
  for (const reason of ['manual_override', 'calibration', 'preview', 'busy', 'linked_control', 'offline']) {
    assert.notEqual(skippedReasonKey(reason), 'skippedOther')
  }
})

test('only an exact action and opaque request ID can settle this page mutation', () => {
  const pending = { action: 'save_config', requestId: 'page-session:2' }
  assert.equal(matchingMutation(pending, { ...pending }), true)
  for (const result of [{ action: 'save_config' }, { action: 'save_config', requestId: 'page-session:1' },
    { action: 'set_enabled', requestId: pending.requestId }, { action: 'save_config', requestId: 'other-page:2' }]) {
    assert.equal(matchingMutation(pending, result), false)
  }
  assert.equal(matchingMutation(null, pending), false)
})

test('incomplete config must not be normalized into a writable empty snapshot', () => {
  for (const value of [undefined, null, {}, [], { enabled: true, rules: [] }, { enabled: true, rules: [], baseline: {} }]) {
    assert.equal(isConfigSnapshot(value), false)
  }
  assert.equal(isConfigSnapshot({ enabled: false, rules: [], baseline: { actions: [] } }), true)
})
