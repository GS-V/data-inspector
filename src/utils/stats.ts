/*
 * Descriptive statistics for a numeric array or for one column of a sheet.
 * Pure functions -- no React, no Zustand. The column readers take cellState, so every statistic
 * reflects the cleaned overlay rather than the raw rows.
 * Variance uses the sample denominator (n - 1), matching R's sd() and pandas' default std().
 */
import type { CellState, DistributionSummary, RowData } from '../types/data'
import { makeCellId } from './cellId'
import { getEffectiveValue, isMissing, toNumber } from './numeric'

function quantile(sortedValues: number[], probability: number): number | null {
  if (sortedValues.length === 0) {
    return null
  }

  const position = (sortedValues.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lowerValue = sortedValues[lowerIndex]
  const upperValue = sortedValues[upperIndex]

  if (lowerValue === undefined || upperValue === undefined) {
    return null
  }

  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex)
}

export function summarizeNumbers(values: number[], missingCount: number): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  const mean = count ? sorted.reduce((sum, value) => sum + value, 0) / count : null
  const q1 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null
  const variance =
    count > 1 && mean !== null
      ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
      : null

  return {
    count,
    missingCount,
    mean,
    median,
    min: sorted[0] ?? null,
    q1,
    q3,
    max: sorted[sorted.length - 1] ?? null,
    iqr,
    standardDeviation: variance === null ? null : Math.sqrt(variance),
  }
}

export function getColumnNumbers(
  rows: RowData[],
  sheetName: string,
  columnName: string,
  cellState: Record<string, CellState>,
): { values: number[]; missingCount: number } {
  const values: number[] = []
  let missingCount = 0

  rows.forEach((row, rowIndex) => {
    const cellId = makeCellId(sheetName, rowIndex, columnName)
    const effectiveValue = getEffectiveValue(row[columnName], cellState[cellId])
    const numericValue = toNumber(effectiveValue)

    if (isMissing(effectiveValue) || numericValue === null) {
      missingCount += 1
      return
    }

    values.push(numericValue)
  })

  return { values, missingCount }
}

export function summarizeColumn(
  rows: RowData[],
  sheetName: string,
  columnName: string,
  cellState: Record<string, CellState>,
): DistributionSummary {
  const { values, missingCount } = getColumnNumbers(rows, sheetName, columnName, cellState)
  return summarizeNumbers(values, missingCount)
}

export function formatNumber(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) {
    return '-'
  }

  return Number(value.toFixed(digits)).toLocaleString()
}

/*
 * Pearson r for two numeric arrays.
 * Excludes null/NaN pairs. Returns NaN if fewer than 2 paired
 * values exist or if either variable has zero variance.
 */
export function pearsonR(
  xs: (number | null)[],
  ys: (number | null)[]
): number {
  const pairs: [number, number][] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]; const y = ys[i]
    if (x != null && y != null && isFinite(x) && isFinite(y)) {
      pairs.push([x, y])
    }
  }
  if (pairs.length < 2) return NaN
  const n = pairs.length
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n
  const my = pairs.reduce((s, p) => s + p[1], 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (const [x, y] of pairs) {
    const ex = x - mx; const ey = y - my
    num += ex * ey; dx2 += ex * ex; dy2 += ey * ey
  }
  const denom = Math.sqrt(dx2) * Math.sqrt(dy2)
  return denom === 0 ? NaN : num / denom
}

/*
 * Convert a numeric array to fractional ranks (average rank for ties).
 * Null/NaN positions stay null. Used by spearmanR.
 */
function rankArray(xs: (number | null)[]): (number | null)[] {
  const indexed = xs
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } =>
      d.v != null && isFinite(d.v)
    )
    .sort((a, b) => a.v - b.v)
  const ranks: (number | null)[] = new Array(xs.length).fill(null)
  let j = 0
  while (j < indexed.length) {
    let k = j
    while (k + 1 < indexed.length && indexed[k + 1].v === indexed[j].v) k++
    const avgRank = (j + k) / 2 + 1
    for (let m = j; m <= k; m++) ranks[indexed[m].i] = avgRank
    j = k + 1
  }
  return ranks
}

/*
 * Spearman rank correlation.
 * Robust to outliers and non-linear monotonic relationships.
 * Drops incomplete pairs first, so both columns are ranked over the same rows,
 * then applies average-rank tie-breaking and delegates to pearsonR on the ranks.
 */
export function spearmanR(
  xs: (number | null)[],
  ys: (number | null)[]
): number {
  const px: number[] = []; const py: number[] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]; const y = ys[i]
    if (x != null && y != null && isFinite(x) && isFinite(y)) {
      px.push(x); py.push(y)
    }
  }
  return pearsonR(rankArray(px), rankArray(py))
}

/*
 * Kendall tau-b.
 * Counts concordant minus discordant pairs, corrected for ties.
 * O(n²) — suitable for datasets up to ~5 000 rows.
 * More interpretable than r for small samples or tied data:
 * τ = 0.5 means roughly half of all pairs agree in direction.
 */
export function kendallTauB(
  xs: (number | null)[],
  ys: (number | null)[]
): number {
  const pairs: [number, number][] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]; const y = ys[i]
    if (x != null && y != null && isFinite(x) && isFinite(y)) {
      pairs.push([x, y])
    }
  }
  if (pairs.length < 2) return NaN
  let C = 0, D = 0, Tx = 0, Ty = 0
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const dx = pairs[i][0] - pairs[j][0]
      const dy = pairs[i][1] - pairs[j][1]
      // A pair tied on both variables counts toward neither tie term (scipy / R behaviour).
      if (dx === 0 && dy === 0) continue
      else if (dx === 0) Tx++
      else if (dy === 0) Ty++
      else if (dx * dy > 0) C++
      else D++
    }
  }
  const denom = Math.sqrt((C + D + Tx) * (C + D + Ty))
  return denom === 0 ? NaN : (C - D) / denom
}

// Two-tailed standard normal tail, 2 * (1 - Phi(|z|)) = erfc(|z| / sqrt(2)).
// Abramowitz & Stegun 7.1.26 (erf max abs error ~1.5e-7), evaluated as erfc directly: computing
// 1 - Phi(z) by subtraction rounds to exactly 0 once z passes ~8, reporting p = 0.
function normalTwoTailedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return poly * Math.exp(-x * x)
}

// Lanczos approximation (g = 7, n = 9) -- ~15 significant digits for x > 0.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  x -= 1
  let a = LANCZOS[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// Continued fraction for the incomplete beta function (modified Lentz, Numerical Recipes 6.4).
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY
    d = 1 / d; h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return h
}

// Regularized incomplete beta I_x(a, b).
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

// Two-tailed p-value for Pearson or Spearman.
// t = r * sqrt((n-2) / (1-r^2)), df = n-2, evaluated against the exact Student t distribution
// (not a normal approximation, which understates p near 0.05 for n up to ~50 and would award
// stars that scipy.stats.pearsonr / spearmanr do not).
// Returns NaN when n < 4 or r is NaN, 0 when |r| == 1.
export function correlationPValue(r: number, n: number): number {
  if (n < 4 || Number.isNaN(r)) return NaN
  if (Math.abs(r) >= 1) return 0
  const df = n - 2
  const t = r * Math.sqrt(df / (1 - r * r))
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

// Two-tailed p-value for Kendall tau-b via normal approximation.
// z = tau / sqrt(2*(2n+5) / (9*n*(n-1))). This variance has no tie correction, so with many
// tied values it is conservative relative to scipy.stats.kendalltau.
// Returns NaN when n < 4 or tau is NaN, 0 when |tau| == 1.
export function kendallPValue(tau: number, n: number): number {
  if (n < 4 || Number.isNaN(tau)) return NaN
  if (Math.abs(tau) >= 1) return 0
  const variance = (2 * (2 * n + 5)) / (9 * n * (n - 1))
  return normalTwoTailedP(tau / Math.sqrt(variance))
}

// 95% CI for Pearson or Spearman via Fisher z-transform.
// Returns [NaN, NaN] when n < 4, r is NaN, or |r| == 1. Not provided for Kendall.
export function correlationCI(
  r: number,
  n: number,
  method: 'pearson' | 'spearman' = 'pearson'
): [number, number] {
  if (n < 4 || Number.isNaN(r) || Math.abs(r) >= 1) return [NaN, NaN]
  const z = Math.atanh(r)
  // Asymptotic Fisher-z variance: 1/(n-3) for Pearson; (1+r²/2)/(n-3) for Spearman
  // (Bonett & Wright 2000). Using the Pearson variance for Spearman makes the CI too narrow.
  const variance = method === 'spearman' ? (1 + (r * r) / 2) / (n - 3) : 1 / (n - 3)
  const se = Math.sqrt(variance)
  return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)]
}

export type CorrelationCellStats = {
  r: number // correlation coefficient
  n: number // paired observations used (nulls dropped)
  p: number // two-tailed p-value (raw, uncorrected)
  ciLow: number // 95% CI lower (NaN for Kendall)
  ciHigh: number // 95% CI upper (NaN for Kendall)
}

function isPresent(v: number | null): v is number {
  return v != null && isFinite(v)
}

/*
 * Build a symmetric correlation matrix for the given columns, plus per-cell statistics.
 * Diagonal entries are 1. Off-diagonal entries are NaN when
 * insufficient paired data exists.
 */
export function buildCorrelationMatrix(
  columnValues: { name: string; values: (number | null)[] }[],
  method: 'pearson' | 'spearman' | 'kendall'
): { labels: string[]; matrix: number[][]; statsMatrix: CorrelationCellStats[][] } {
  const fn = method === 'pearson'
    ? pearsonR
    : method === 'spearman'
    ? spearmanR
    : kendallTauB
  const n = columnValues.length
  const labels = columnValues.map((c) => c.name)
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(NaN)
  )
  const statsMatrix: CorrelationCellStats[][] = Array.from({ length: n }, () => Array(n))
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1
    const presentCount = columnValues[i].values.filter(isPresent).length
    statsMatrix[i][i] = { r: 1, n: presentCount, p: 0, ciLow: 1, ciHigh: 1 }
    for (let j = i + 1; j < n; j++) {
      const xs = columnValues[i].values
      const ys = columnValues[j].values
      const r = fn(xs, ys)
      matrix[i][j] = r
      matrix[j][i] = r
      let pairs = 0
      for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
        if (isPresent(xs[k]) && isPresent(ys[k])) pairs++
      }
      const p = method === 'kendall' ? kendallPValue(r, pairs) : correlationPValue(r, pairs)
      const [ciLow, ciHigh] = method === 'kendall' ? [NaN, NaN] : correlationCI(r, pairs, method)
      const cell = { r, n: pairs, p, ciLow, ciHigh }
      statsMatrix[i][j] = cell
      statsMatrix[j][i] = cell
    }
  }
  return { labels, matrix, statsMatrix }
}
