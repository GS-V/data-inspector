import type { CellId, CellState, NormalityTestResult, NormalityTestType, SheetData, TransformationType } from '../types/data'
import { getVisibleColumnValues, normalQuantile } from './chartData'

export type TransformParams = {
  useOffset?: boolean
  lambda?: number
  mean?: number
  sd?: number
  base?: number
}

/**
 * Natural log: y = ln(x). Requires x > 0.
 * Out-of-domain input returns null, so the caller skips the cell rather than storing NaN.
 */
function applyLog(value: number, useOffset?: boolean): number | null {
  const input = useOffset ? value + 1 : value
  if (input <= 0) {
    return null
  }
  return Math.log(input)
}

/**
 * Log at a chosen base: y = ln(x) / ln(base). The base is 10 unless another one is given.
 * Base 10 calls Math.log10 directly. Any other base greater than 1 uses change of base.
 * Requires x > 0, the same domain as natural log.
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

/**
 * Square root: y = √x, requires x >= 0.
 * x = 0 is in domain here (√0 = 0), unlike the log-family transforms. Only negative input skips.
 */
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

/**
 * Z-score: y = (x − mean) / SD.
 * Undefined without both mean and SD, and undefined when SD is 0 for a constant column.
 */
function applyZScore(value: number, mean?: number, sd?: number): number | null {
  if (mean === undefined || sd === undefined || sd === 0) {
    return null
  }
  return (value - mean) / sd
}

/** Dispatch to the transform matching `type`. Return null when the input is out of domain. */
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

/** Report whether a transform can run on these values, ignoring the +1 offset remedy. */
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

/** Return the transform types to suggest when the requested one is infeasible. */
export function suggestAlternativeTransforms(type: TransformationType): TransformationType[] {
  return ALTERNATIVE_TRANSFORMS[type]
}

/** Return the sample skewness, as the adjusted Fisher-Pearson standardized moment coefficient. */
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

/** Grid-search lambda over [-2, 2] in 0.05 steps, minimizing |skewness| of the Box-Cox result. */
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

/** Return coarse histogram bucket counts, used to draw a sparkline thumbnail. */
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

/** Return a column's visible values as a plain numeric array, dropping the row and cell keys. */
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

/** Forward standard normal CDF, Φ(z). Its inverse is normalQuantile in chartData.ts. */
export function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Evaluate a polynomial by Horner's method, where coeffs[i] is the coefficient of x^i. */
function poly(coeffs: number[], x: number): number {
  let result = 0
  for (let i = coeffs.length - 1; i >= 0; i -= 1) {
    result = result * x + coeffs[i]
  }
  return result
}

/**
 * Report whether every value is identical, by exact pairwise comparison.
 * Do not test a computed variance or sum of squares against 0 instead. Summing one
 * long-mantissa value repeatedly loses precision: Math.log(7) added to itself 20 times, then
 * divided by 20, does not always return the original bits. A constant column's mean can
 * therefore differ from every element by about 1e-16. A `variance === 0` guard then fails to
 * fire, and a degenerate column reports a spurious statistic instead of "not computed".
 * Comparing the values directly accumulates no such error.
 */
function isConstant(values: number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0])
}

/**
 * Jarque-Bera test.
 * Uses BIASED skewness and kurtosis, meaning the population form that divides by n. That is the
 * classic Jarque-Bera definition. This deliberately does not reuse calculateSkewness(), which
 * returns the bias-corrected Fisher-Pearson G1 used for the before/after display.
 * Mixing the two forms would silently disagree with R and scipy on the same data.
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
 * Shapiro-Wilk test, Royston's 1992/1995 approximation (AS R94).
 * Verified against the C source of R's stats::shapiro.test. This is the default test.
 * Keep both branch splits exactly as specified: n <= 5 against n > 5 for the weight correction,
 * and n <= 11 against n > 11 for the p-value. Dropping either split returns wrong p-values at
 * small sample sizes, and field-trial replicate counts are usually small.
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
  const a: number[] = new Array(nn2 + 1).fill(0) // 1-indexed to match AS R94, so a[0] is unused

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
 * Anderson-Darling test, D'Agostino & Stephens (1986) case 3.
 * Case 3 means mean and variance are unknown and estimated from the data.
 * Verified against the source of R's nortest::ad.test.
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

/** Run the requested normality test. Call this rather than a specific test function. */
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
