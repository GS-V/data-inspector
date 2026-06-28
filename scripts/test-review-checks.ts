import assert from 'node:assert/strict'
import {
  duplicateValueKeys,
  isValidPercentileRange,
  percentileBounds,
} from '../src/utils/reviewChecks.ts'

const duplicateKeys = duplicateValueKeys(['A1', 'A2', 'A1', '', null, undefined, '  ', 'A3', 'A2'])
assert.deepEqual(Array.from(duplicateKeys).sort(), ['A1', 'A2'])

assert.equal(isValidPercentileRange(1, 99), true)
assert.equal(isValidPercentileRange(99, 1), false)
assert.equal(isValidPercentileRange(-1, 99), false)
assert.equal(isValidPercentileRange(1, 101), false)

const bounds = percentileBounds([1, 2, 3, 4, 100], 20, 80)
assert.ok(bounds)
assert.equal(bounds.lowerValue, 1.8)
assert.equal(bounds.upperValue, 23.200000000000017)

assert.equal(percentileBounds([1, 2, 3], 90, 10), null)
assert.equal(percentileBounds([], 1, 99), null)

console.log('review-checks: 8 checks passed')
