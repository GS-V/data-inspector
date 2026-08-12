import assert from 'node:assert/strict'
import { useDataInspectorStore } from '../src/store/useDataInspectorStore.ts'

function setAndGet(value: number): number {
  useDataInspectorStore.getState().setNormalityThreshold(value)
  return useDataInspectorStore.getState().normalityThreshold
}

assert.equal(useDataInspectorStore.getState().normalityThreshold, 0.05, 'default should be 0.05')
assert.equal(useDataInspectorStore.getState().normalityTestType, 'shapiro-wilk', 'default test should be shapiro-wilk')

assert.equal(setAndGet(0), 0.001, '0 should clamp to 0.001')
assert.equal(setAndGet(-5), 0.001, 'negative should clamp to 0.001')
assert.equal(setAndGet(1.5), 0.5, '1.5 should clamp to 0.5')
assert.equal(setAndGet(1), 0.5, '1 (boundary, not < 1) should clamp to 0.5')
assert.equal(setAndGet(Number('not-a-number')), 0.05, 'NaN (non-numeric text) should fall back to 0.05')
assert.equal(setAndGet(0.01), 0.01, 'valid in-range value should pass through verbatim')
assert.equal(setAndGet(0.5), 0.5, 'boundary 0.5 (valid, < 1) should pass through verbatim')
assert.equal(setAndGet(0.001), 0.001, 'boundary 0.001 (valid, > 0) should pass through verbatim')

console.log('ALL THRESHOLD CLAMP CHECKS PASSED')
