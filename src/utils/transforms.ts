import type { CellId, CellState, NormalityTestResult, NormalityTestType, SheetData, TransformationType } from '../types/data'
import { getVisibleColumnValues, normalQuantile } from './chartData'

export type TransformParams = {
  useOffset?: boolean
  lambda?: number
  mean?: number
  sd?: number
  base?: number
}

/** Natural log: y = ln(x). Requires x > 0; out-of-domain input returns null (skip) rather than NaN. */
function applyLog(value: number, useOffset?: boolean): number | null {
  const input = useOffset ? value + 1 : value
  if (input <= 0) {
    return null
  }
  return Math.log(input)
}

/**
 * Log at a chosen base: y = ln(x) / ln(base), i.e. base 10 unless a different base is given.
 * Base 10 uses Math.log10 directly; any other base (> 1) uses the change-of-base identity.
 * Requires x > 0, same as natural log.
 */
function applyLog10(value: number, useOffset?: boolean, base?: number): number | null {
  const input = useOffset ? value + 1 : value
  if (input <= 0) {
    return null
  }
  if (base === undefined || base === 10) {
    return Math.log10(input)
  }
  return Math.log(input) / Math.log(base)
}

/** Square root: y = √x, requires x >= 0. Unlike the log-family transforms, x = 0 is in-domain (√0 = 0), so only negative input is skipped. */
function applySqrt(value: number): number | null {
  if (value < 0) {
    return null
  }
  return Math.sqrt(value)
}

/** Box-Cox: y = (x^λ − 1) / λ for λ ≠ 0, or y = ln(x) when λ = 0. Requires x > 0. */
function applyBoxCox(value: number, lambda: number): number | null {
  if (value <= 0) {
    return null
  }
  return lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda
}

/** Z-score: y = (x − mean) / SD. Undefined without both mean and SD, or when SD is 0 (constant column). */
function applyZScore(value: number, mean?: number, sd?: number): number | null {
  if (mean === undefined || sd === undefined || sd === 0) {
    return null
  }
  return (value - mean) / sd
}

/** Dispatches to the transform matching `type`. Returns null when the input is out of domain. */
export function transformValue(value: number, type: TransformationType, params?: TransformParams): number | null {
  switch (type) {
    case 'log':
      return applyLog(value, params?.useOffset)
    case 'log10':
      return applyLog10(value, params?.useOffset, params?.base)
    case 'sqrt':
      return applySqrt(value)
    case 'boxcox':
      return applyBoxCox(value, params?.lambda ?? 1)
    case 'zscore':
      return applyZScore(value, params?.mean, params?.sd)
    default:
      return null
  }
}

export type TransformFeasibility = {
  feasible: boolean
  zeroNegativeCount: number
  issues: string[]
}

/** Checks whether a transform can run on the given values, ignoring any +1 offset remedy. */
export function validateTransformFeasibility(values: number[], type: TransformationType): TransformFeasibility {
  if (type === 'zscore') {
    if (values.length < 2) {
      return {
        feasible: false,
        zeroNegativeCount: 0,
        issues: ['At least two numeric values are needed to compute a z-score.'],
      }
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    if (Math.sqrt(variance) === 0) {
      return {
        feasible: false,
        zeroNegativeCount: 0,
        issues: ['All values are identical; z-score is undefined.'],
      }
    }

    return { feasible: true, zeroNegativeCount: 0, issues: [] }
  }

  const zeroNegativeCount = values.filter((value) => value <= 0).length
  const issues =
    zeroNegativeCount > 0
      ? [`${zeroNegativeCount} value${zeroNegativeCount === 1 ? '' : 's'} are zero or negative and cannot be transformed directly.`]
      : []

  return { feasible: zeroNegativeCount === 0, zeroNegativeCount, issues }
}

const ALTERNATIVE_TRANSFORMS: Record<TransformationType, TransformationType[]> = {
  log: ['log10', 'zscore'],
  log10: ['log', 'zscore'],
  sqrt: ['boxcox', 'zscore'],
  boxcox: ['sqrt', 'zscore'],
  zscore: ['log', 'sqrt'],
}

/** Alternative transform types to suggest when the requested one is infeasible. */
export function suggestAlternativeTransforms(type: TransformationType): TransformationType[] {
  return ALTERNATIVE_TRANSFORMS[type]
}

/** Adjusted Fisher-Pearson standardized moment coefficient (sample skewness). */
export function calculateSkewness(values: number[]): number | null {
  const n = values.length
  if (n < 3) {
    return null
  }

  if (isConstant(values)) {
    return 0
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)

  const sumCubed = values.reduce((sum, value) => sum + ((value - mean) / sd) ** 3, 0)
  return (n / ((n - 1) * (n - 2))) * sumCubed
}

/** Grid search over lambda in [-2, 2] step 0.05, minimizing |skewness| of the Box-Cox result. */
export function estimateOptimalBoxCoxLambda(values: number[]): number {
  const positiveValues = values.filter((value) => value > 0)
  if (positiveValues.length < 3) {
    return 1
  }

  let bestLambda = 1
  let bestScore = Infinity

  for (let step = -40; step <= 40; step += 1) {
    const lambda = Math.round(step * 0.05 * 100) / 100
    const transformed = positiveValues.map((value) => (lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda))
    const skewness = calculateSkewness(transformed)
    if (skewness === null) {
      continue
    }

    const score = Math.abs(skewness)
    if (score < bestScore) {
      bestScore = score
      bestLambda = lambda
    }
  }

  return bestLambda
}

/** Coarse histogram bucket counts, used to draw a sparkline thumbnail. */
export function computeSparkbucket(values: number[], bucketCount = 12): number[] {
  const buckets = new Array(bucketCount).fill(0)
  if (values.length === 0) {
    return buckets
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    buckets[Math.floor(bucketCount / 2)] = values.length
    return buckets
  }

  const span = max - min
  values.forEach((value) => {
    const index = Math.min(bucketCount - 1, Math.floor(((value - min) / span) * bucketCount))
    buckets[index] += 1
  })

  return buckets
}

/** Convenience wrapper reusing chartData's cellState-aware value filter for plain numeric arrays. */
export function getColumnNumericValues(
  sheet: SheetData,
  columnName: string,
  cellState: Record<CellId, CellState>,
): number[] {
  return getVisibleColumnValues(sheet, columnName, cellState).map((entry) => entry.value)
}

/** Abramowitz & Stegun 7.1.26 erf approximation, max error ~1.5e-7. */
function erf(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x)
  const t = 1 / (1 + p * absX)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX)
  return sign * y
}

/** Forward standard normal CDF, Φ(z). Distinct from normalQuantile (its inverse) in chartData.ts. */
export function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Horner evaluation of a polynomial where coeffs[i] is the coefficient of x^i. */
function poly(coeffs: number[], x: number): number {
  let result = 0
  for (let i = coeffs.length - 1; i >= 0; i -= 1) {
    result = result * x + coeffs[i]
  }
  return result
}

/**
 * Exact pairwise equality check for "all values identical," used instead of testing whether
 * a computed variance/sum-of-squares equals 0. Repeated floating-point summation of an
 * identical long-mantissa value (e.g. Math.log(7) added to itself 20 times, then divided by
 * n) does not always round-trip back to bit-identical the original value, so a constant
 * column's mean can differ from every element by ~1e-16 — making a `variance === 0` guard
 * fail to fire and letting a degenerate column produce a spurious nonzero statistic instead
 * of the "not computed" result it should. Comparing values directly has no such accumulation.
 */
function isConstant(values: number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0])
}

/**
 * Jarque-Bera test. Uses BIASED (population, divide-by-n) skewness and kurtosis —
 * this is the classic JB definition and deliberately does NOT reuse calculateSkewness(),
 * which computes the bias-corrected Fisher-Pearson G1 used for the before/after display.
 * Mixing the two would silently disagree with every reference implementation (R, scipy)
 * on the same data.
 */
export function jarqueBeraTest(values: number[]): NormalityTestResult {
  const n = values.length
  if (n < 8) {
    return {
      testName: 'jarque-bera',
      statistic: null,
      pValue: null,
      n,
      warnings: ['Jarque-Bera needs at least 8 values for a meaningful asymptotic approximation.'],
    }
  }

  if (isConstant(values)) {
    return {
      testName: 'jarque-bera',
      statistic: null,
      pValue: null,
      n,
      warnings: ['All values are identical; skewness and kurtosis are undefined.'],
    }
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / n
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const v of values) {
    const d = v - mean
    m2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
  }
  m2 /= n
  m3 /= n
  m4 /= n

  const skewness = m3 / m2 ** 1.5
  const excessKurtosis = m4 / (m2 * m2) - 3
  const jb = (n / 6) * (skewness ** 2 + (excessKurtosis ** 2) / 4)
  const pValue = Math.exp(-jb / 2) // exact chi-squared(df=2) survival function

  const warnings = n < 30 ? ['Jarque-Bera is asymptotic; treat results for n < 30 cautiously.'] : []
  return { testName: 'jarque-bera', statistic: jb, pValue, n, warnings }
}

/**
 * Shapiro-Wilk test, Royston's 1992/1995 approximation (AS R94), verified against R's
 * stats::shapiro.test C source. This is the default test — implement exactly as specified,
 * including the n<=5 vs n>5 weight-correction split and the n<=11 vs n>11 p-value split.
 * Skipping either split gives wrong p-values for small sample sizes, which are common
 * in field-trial replicate counts.
 */
export function shapiroWilkTest(values: number[]): NormalityTestResult {
  const n = values.length
  if (n < 3) {
    return { testName: 'shapiro-wilk', statistic: null, pValue: null, n, warnings: ['Shapiro-Wilk needs at least 3 values.'] }
  }

  if (isConstant(values)) {
    return { testName: 'shapiro-wilk', statistic: null, pValue: null, n, warnings: ['All values are identical; Shapiro-Wilk is undefined.'] }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n
  const ssq = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0)

  const nn2 = Math.floor(n / 2)
  const a: number[] = new Array(nn2 + 1).fill(0) // 1-indexed; a[0] unused

  if (n === 3) {
    a[1] = 0.70710678
  } else {
    const an25 = n + 0.25
    const m: number[] = new Array(nn2 + 1).fill(0)
    let summ2 = 0
    for (let i = 1; i <= nn2; i += 1) {
      m[i] = normalQuantile((i - 0.375) / an25)
      summ2 += m[i] * m[i]
    }
    summ2 *= 2
    const ssumm2 = Math.sqrt(summ2)
    const rsn = 1 / Math.sqrt(n)
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056]
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633]
    const a1 = poly(c1, rsn) - m[1] / ssumm2

    let fac: number
    let startIndex: number
    if (n > 5) {
      const a2 = poly(c2, rsn) - m[2] / ssumm2
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2 - 2 * m[2] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2))
      a[2] = a2
      startIndex = 3
    } else {
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2))
      startIndex = 2
    }
    a[1] = a1
    for (let i = startIndex; i <= nn2; i += 1) {
      a[i] = -m[i] / fac
    }
  }

  let numerator = 0
  for (let i = 1; i <= nn2; i += 1) {
    numerator += a[i] * (sorted[n - i] - sorted[i - 1])
  }
  const w = (numerator * numerator) / ssq
  const wClamped = Math.min(1, Math.max(1e-12, w))

  let pValue: number
  if (n === 3) {
    pValue = (6 / Math.PI) * (Math.asin(Math.sqrt(wClamped)) - Math.asin(Math.sqrt(0.75)))
  } else {
    const y = Math.log(1 - wClamped)
    let z: number
    if (n <= 11) {
      const g = [-2.273, 0.459]
      const gamma = poly(g, n)
      if (y >= gamma) {
        return { testName: 'shapiro-wilk', statistic: w, pValue: 1e-99, n, warnings: [] }
      }
      const c3 = [0.544, -0.39978, 0.025054, -0.0006714]
      const c4 = [1.3822, -0.77857, 0.062767, -0.0020322]
      const yAdj = -Math.log(gamma - y)
      const mCoef = poly(c3, n)
      const sCoef = Math.exp(poly(c4, n))
      z = (yAdj - mCoef) / sCoef
    } else {
      const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915]
      const c6 = [-0.4803, -0.082676, 0.0030302]
      const x = Math.log(n)
      const mCoef = poly(c5, x)
      const sCoef = Math.exp(poly(c6, x))
      z = (y - mCoef) / sCoef
    }
    pValue = 1 - normalCDF(z)
  }

  pValue = Math.min(1, Math.max(0, pValue))
  const warnings = n > 5000 ? ['Sample size exceeds the validated range (n ≤ 5000) for this approximation.'] : []
  return { testName: 'shapiro-wilk', statistic: w, pValue, n, warnings }
}

/**
 * Anderson-Darling test, D'Agostino & Stephens (1986) case 3 (mean and variance unknown,
 * estimated from data). Verified against R's nortest::ad.test source.
 */
export function andersonDarlingTest(values: number[]): NormalityTestResult {
  const n = values.length
  if (n < 8) {
    return { testName: 'anderson-darling', statistic: null, pValue: null, n, warnings: ['Anderson-Darling needs at least 8 values for reliable results.'] }
  }

  if (isConstant(values)) {
    return { testName: 'anderson-darling', statistic: null, pValue: null, n, warnings: ['All values are identical; standard deviation is zero.'] }
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / n
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)

  const sorted = [...values].sort((a, b) => a - b)
  const z = sorted.map((v) => (v - mean) / sd)

  let sum = 0
  for (let i = 0; i < n; i += 1) {
    const lower = Math.log(normalCDF(z[i]))
    const upper = Math.log(1 - normalCDF(z[n - 1 - i]))
    sum += (2 * (i + 1) - 1) * (lower + upper)
  }
  const a2 = -n - sum / n
  const a2Star = a2 * (1 + 0.75 / n + 2.25 / (n * n))

  let pValue: number
  if (a2Star < 0.2) {
    pValue = 1 - Math.exp(-13.436 + 101.14 * a2Star - 223.73 * a2Star ** 2)
  } else if (a2Star < 0.34) {
    pValue = 1 - Math.exp(-8.318 + 42.796 * a2Star - 59.938 * a2Star ** 2)
  } else if (a2Star < 0.6) {
    pValue = Math.exp(0.9177 - 4.279 * a2Star - 1.38 * a2Star ** 2)
  } else if (a2Star < 10) {
    pValue = Math.exp(1.2937 - 5.709 * a2Star + 0.0186 * a2Star ** 2)
  } else {
    pValue = 3.7e-24
  }
  pValue = Math.min(1, Math.max(0, pValue))

  return { testName: 'anderson-darling', statistic: a2Star, pValue, n, warnings: [] }
}

/** Dispatcher used everywhere else in the app instead of calling a specific test directly. */
export function runNormalityTest(values: number[], type: NormalityTestType): NormalityTestResult {
  switch (type) {
    case 'shapiro-wilk':
      return shapiroWilkTest(values)
    case 'jarque-bera':
      return jarqueBeraTest(values)
    case 'anderson-darling':
      return andersonDarlingTest(values)
  }
}
