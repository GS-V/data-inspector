import assert from 'node:assert/strict'
import {
  andersonDarlingTest,
  jarqueBeraTest,
  runNormalityTest,
  shapiroWilkTest,
} from '../src/utils/transforms.ts'

// --- mulberry32: small, well-tested seeded PRNG (avoids simple-LCG correlation artifacts) ---
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normalSample(n: number, seed: number, mean = 0, sd = 1): number[] {
  const rand = mulberry32(seed)
  const values: number[] = []
  for (let i = 0; i < n; i += 1) {
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    values.push(mean + sd * z)
  }
  return values
}

/** Exponential(rate=1) via inverse-CDF: skewness=2, excess kurtosis=6 — a reliably-skewed reference. */
function skewedSample(n: number, seed: number): number[] {
  const rand = mulberry32(seed)
  const values: number[] = []
  for (let i = 0; i < n; i += 1) {
    const u = Math.max(rand(), 1e-12)
    values.push(-Math.log(1 - u))
  }
  return values
}

console.log('=== Directional sanity checks ===')
for (const n of [8, 15, 30, 50]) {
  const normalValues = normalSample(n, 42 + n)
  const skewedValues = skewedSample(n, 99 + n)

  for (const [label, values] of [
    ['normal', normalValues],
    ['skewed', skewedValues],
  ] as const) {
    const sw = shapiroWilkTest(values)
    const jb = jarqueBeraTest(values)
    const ad = andersonDarlingTest(values)
    console.log(
      `n=${n} ${label}: SW p=${sw.pValue?.toFixed(4)} JB p=${jb.pValue?.toFixed(4)} AD p=${ad.pValue?.toFixed(4)}`,
    )
  }
}

// Directional assertions at n=30 (large enough for all three tests to be reliable).
// Reuses the same seeds as the printed table above (42+n / 99+n) rather than fresh
// arbitrary seeds: a valid test at alpha=0.05 WILL reject ~5% of true-normal draws by
// chance, so an assertion must pin a seed already observed to give a clean, non-borderline
// margin rather than asserting "always passes," which is not a true statistical property.
{
  const normalValues = normalSample(30, 42 + 30)
  const skewedValues = skewedSample(30, 99 + 30)

  const swNormal = shapiroWilkTest(normalValues)
  const jbNormal = jarqueBeraTest(normalValues)
  const adNormal = andersonDarlingTest(normalValues)
  assert.ok(swNormal.pValue !== null && swNormal.pValue > 0.05, `SW should not reject normal sample, got p=${swNormal.pValue}`)
  assert.ok(jbNormal.pValue !== null && jbNormal.pValue > 0.05, `JB should not reject normal sample, got p=${jbNormal.pValue}`)
  assert.ok(adNormal.pValue !== null && adNormal.pValue > 0.05, `AD should not reject normal sample, got p=${adNormal.pValue}`)

  const swSkewed = shapiroWilkTest(skewedValues)
  const jbSkewed = jarqueBeraTest(skewedValues)
  const adSkewed = andersonDarlingTest(skewedValues)
  assert.ok(swSkewed.pValue !== null && swSkewed.pValue < 0.05, `SW should reject skewed sample, got p=${swSkewed.pValue}`)
  assert.ok(jbSkewed.pValue !== null && jbSkewed.pValue < 0.05, `JB should reject skewed sample, got p=${jbSkewed.pValue}`)
  assert.ok(adSkewed.pValue !== null && adSkewed.pValue < 0.05, `AD should reject skewed sample, got p=${adSkewed.pValue}`)
  console.log('Directional assertions at n=30 passed.')
}

console.log('\n=== Edge cases ===')

// Constant column
for (const test of [shapiroWilkTest, jarqueBeraTest, andersonDarlingTest]) {
  const result = test(new Array(20).fill(7))
  assert.equal(result.pValue, null)
  assert.equal(result.statistic, null)
  assert.ok(result.warnings.length > 0)
}
console.log('Constant-column handling OK for all three tests.')

// n below minimum
assert.equal(shapiroWilkTest([1, 2]).pValue, null)
assert.equal(jarqueBeraTest([1, 2, 3, 4, 5]).pValue, null)
assert.equal(andersonDarlingTest([1, 2, 3, 4, 5]).pValue, null)
console.log('Below-minimum n handling OK for all three tests.')

// runNormalityTest dispatcher sanity
const dispatched = runNormalityTest(normalSample(30, 555), 'shapiro-wilk')
assert.equal(dispatched.testName, 'shapiro-wilk')
console.log('Dispatcher OK.')

console.log('\nALL CHECKS PASSED')
