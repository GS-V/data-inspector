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

/*
 * Build a symmetric correlation matrix for the given columns.
 * Diagonal entries are 1. Off-diagonal entries are NaN when
 * insufficient paired data exists.
 */
export function buildCorrelationMatrix(
  columnValues: { name: string; values: (number | null)[] }[],
  method: 'pearson' | 'spearman' | 'kendall'
): { labels: string[]; matrix: number[][] } {
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
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const r = fn(columnValues[i].values, columnValues[j].values)
      matrix[i][j] = r
      matrix[j][i] = r
    }
  }
  return { labels, matrix }
}
