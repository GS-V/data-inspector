import assert from 'node:assert/strict'
import { shapiroWilkTest } from '../src/utils/transforms.ts'

// Ground truth computed with: python3 -c "from scipy.stats import shapiro; ..."
// (scipy 1.13.1). See scratch scipy_check.py used to produce these numbers.
const cases: { name: string; values: number[]; scipyW: number; scipyP: number }[] = [
  {
    name: 'n5_fixed',
    values: [1, 2, 3, 4, 5],
    scipyW: 0.986762155211559,
    scipyP: 0.9671739349728582,
  },
  {
    name: 'n10_skewed',
    values: [1.159569, 0.035059, 0.213673, 0.131252, 1.002304, 0.481537, 0.289804, 1.358109, 0.964133, 1.484822],
    scipyW: 0.9047576701479294,
    scipyP: 0.2468860730419638,
  },
  {
    name: 'n20_normal',
    values: [
      8.221063, 11.820985, 11.958435, 9.683799, 8.932003, 10.433063, 8.48993, 9.653539, 5.354031, 10.102184,
      11.648906, 10.740287, 11.14315, 11.40273, 8.931166, 8.691181, 9.387981, 9.902721, 11.334261, 9.428986,
    ],
    scipyW: 0.9186620236929681,
    scipyP: 0.09338267240452446,
  },
  {
    name: 'n40_skewed',
    values: [
      3.075696, 1.108472, 1.571233, 1.019088, 0.659098, 3.487154, 3.147246, 0.169599, 0.224611, 0.172958, 1.476302,
      0.33827, 2.48576, 2.421909, 1.318186, 0.400949, 2.337341, 2.501972, 0.958765, 1.39273, 1.270407, 0.373909,
      0.197468, 4.5539, 0.336831, 4.829898, 1.149102, 0.576539, 2.278264, 0.375602, 0.744538, 0.674052, 0.038715,
      2.586748, 0.137396, 1.125711, 4.52126, 1.338223, 0.451851, 1.98132,
    ],
    scipyP: 0.000441741390824395,
    scipyW: 0.8771635559415405,
  },
  // Branch boundaries: n=3 (hardcoded weight + arcsine p-value formula), n=6 (first n>5 weight
  // correction), n=11/n=12 (straddling the <=11 vs >11 p-value branch split).
  {
    name: 'n3_boundary',
    values: [1.0, 5.0, 2.0],
    scipyW: 0.923076923076923,
    scipyP: 0.46326287493379903,
  },
  {
    name: 'n6_boundary',
    values: [2.1, 5.5, 3.2, 8.9, 1.0, 4.4],
    scipyW: 0.9551232054740209,
    scipyP: 0.7814781583622636,
  },
  {
    name: 'n11_boundary',
    values: [2.1, 5.5, 3.2, 8.9, 1.0, 4.4, 6.6, 7.7, 0.5, 9.9, 3.3],
    scipyW: 0.9569681240153883,
    scipyP: 0.7333841428125603,
  },
  {
    name: 'n12_boundary',
    values: [2.1, 5.5, 3.2, 8.9, 1.0, 4.4, 6.6, 7.7, 0.5, 9.9, 3.3, 12.1],
    scipyW: 0.9621470612539782,
    scipyP: 0.81398859874275,
  },
]

console.log('=== Shapiro-Wilk ground-truth cross-check vs scipy ===')
for (const testCase of cases) {
  const result = shapiroWilkTest(testCase.values)
  const deltaW = Math.abs((result.statistic ?? NaN) - testCase.scipyW)
  const deltaP = Math.abs((result.pValue ?? NaN) - testCase.scipyP)
  console.log(
    `${testCase.name} (n=${testCase.values.length}): JS W=${result.statistic?.toFixed(6)} p=${result.pValue?.toFixed(6)} | ` +
      `scipy W=${testCase.scipyW.toFixed(6)} p=${testCase.scipyP.toFixed(6)} | dW=${deltaW.toExponential(3)} dp=${deltaP.toExponential(3)}`,
  )
  assert.ok(deltaW < 0.001, `${testCase.name}: |ΔW|=${deltaW} exceeds 0.001 tolerance`)
  assert.ok(deltaP < 0.005, `${testCase.name}: |Δp|=${deltaP} exceeds 0.005 tolerance`)
}

console.log('\nALL GROUND-TRUTH CHECKS PASSED')
