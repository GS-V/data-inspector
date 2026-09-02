/*
 * Chart-shape computations: visible column values, box-plot statistics, KDE, CDF, and Q-Q points.
 * Pure functions -- no React, no Plotly, no Zustand. The caller owns all rendering.
 * getVisibleColumnValues is the only entry point that reads cellState. It drops blanked cells
 * (valueOverride: null), so a blanked value never reaches a chart.
 */
import type { CellId, CellState, SheetData } from '../types/data'
import { makeCellId } from './cellId'
import { getEffectiveValue, toNumber } from './numeric'

export type VisibleColumnValue = {
  rowIndex: number
  cellId: CellId
  value: number
}

// Okabe-Ito colorblind-safe palette, used in order for comparison-column overlays (chart only).
// Deliberately excludes #56B4E9 (sky blue) -- too close to the app's primary accent blue.
export const COMPARISON_COLOR_PALETTE = ['#E69F00', '#009E73', '#CC79A7', '#D55E00']

/**
 * Return the plottable numeric values of a column, each paired with its row index and cell key.
 * Skip any cell blanked through valueOverride: null, and any value that does not parse as a
 * number. Every chart and every transform reads a column through this function, so all of them
 * agree on which cells currently count as data.
 */
export function getVisibleColumnValues(
  sheet: SheetData,
  columnName: string,
  cellState: Record<CellId, CellState>,
): VisibleColumnValue[] {
  const values: VisibleColumnValue[] = []

  sheet.rows.forEach((row, rowIndex) => {
    const cellId = makeCellId(sheet.name, rowIndex, columnName)
    const state = cellState[cellId]
    if (state?.valueOverride === null) {
      return
    }

    const numericValue = toNumber(getEffectiveValue(row[columnName], state))
    if (numericValue === null) {
      return
    }

    values.push({ rowIndex, cellId, value: numericValue })
  })

  return values
}

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

export type BoxPlotStats = {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  lowerFence: number
  upperFence: number
  whiskerMin: number
  whiskerMax: number
  outliers: { value: number; cellId: CellId }[]
}

/** Quartiles, IQR fences, and outlier detection (Tukey's 1.5x IQR rule). */
export function computeBoxPlotStats(entries: VisibleColumnValue[]): BoxPlotStats | null {
  if (entries.length === 0) {
    return null
  }

  const sorted = [...entries].sort((a, b) => a.value - b.value)
  const values = sorted.map((entry) => entry.value)
  const q1 = quantile(values, 0.25)
  const median = quantile(values, 0.5)
  const q3 = quantile(values, 0.75)

  if (q1 === null || median === null || q3 === null) {
    return null
  }

  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr

  const inFence = values.filter((value) => value >= lowerFence && value <= upperFence)
  const outliers = sorted
    .filter((entry) => entry.value < lowerFence || entry.value > upperFence)
    .map((entry) => ({ value: entry.value, cellId: entry.cellId }))

  return {
    min: values[0] ?? 0,
    q1,
    median,
    q3,
    max: values[values.length - 1] ?? 0,
    lowerFence,
    upperFence,
    whiskerMin: inFence.length > 0 ? Math.min(...inFence) : values[0] ?? 0,
    whiskerMax: inFence.length > 0 ? Math.max(...inFence) : values[values.length - 1] ?? 0,
    outliers,
  }
}

// Rational approximation of the inverse standard normal CDF (Acklam's algorithm).
const ACKLAM_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
const ACKLAM_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
const ACKLAM_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

/** Inverse CDF (quantile function) of the standard normal distribution. */
export function normalQuantile(probability: number): number {
  if (probability <= 0) {
    return -Infinity
  }
  if (probability >= 1) {
    return Infinity
  }

  const pLow = 0.02425
  if (probability < pLow) {
    const q = Math.sqrt(-2 * Math.log(probability))
    return (
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    )
  }

  if (probability > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - probability))
    return -(
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    )
  }

  const q = probability - 0.5
  const r = q * q
  return (
    (((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r + ACKLAM_A[4]) * r + ACKLAM_A[5]) *
    q /
    (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r + ACKLAM_B[4]) * r + 1)
  )
}

export type QQPoint = {
  cellId: CellId
  theoretical: number
  sample: number
}

/** Sample quantiles vs theoretical normal quantiles, one point per visible row. */
export function computeQQPlotPoints(entries: VisibleColumnValue[]): QQPoint[] {
  const sorted = [...entries].sort((a, b) => a.value - b.value)
  const n = sorted.length
  if (n === 0) {
    return []
  }

  return sorted.map((entry, index) => {
    // Filliben-style plotting position, well-behaved at the ends of the sample.
    const probability = (index + 1 - 0.5) / n
    return {
      cellId: entry.cellId,
      theoretical: normalQuantile(probability),
      sample: entry.value,
    }
  })
}

export type DensityPoint = { x: number; y: number }

/** Gaussian KDE using Silverman's rule of thumb for bandwidth. */
export function computeDensityPoints(values: number[], gridSize = 200): DensityPoint[] {
  const n = values.length
  if (n === 0) {
    return []
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0
  const standardDeviation = Math.sqrt(variance)
  const bandwidth = standardDeviation > 0 ? 1.06 * standardDeviation * n ** (-1 / 5) : 1

  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = (max - min) * 0.1 || bandwidth * 3 || 1
  const gridMin = min - padding
  const gridMax = max + padding
  const step = (gridMax - gridMin) / (gridSize - 1)

  const points: DensityPoint[] = []
  for (let i = 0; i < gridSize; i += 1) {
    const x = gridMin + i * step
    let sum = 0
    for (const value of values) {
      const u = (x - value) / bandwidth
      sum += Math.exp(-0.5 * u * u)
    }
    points.push({ x, y: sum / (n * bandwidth * Math.sqrt(2 * Math.PI)) })
  }

  return points
}

export type ReferenceLine = { slope: number; intercept: number }

/** Least-squares line fit, used as the Q-Q plot's normality reference line. */
export function fitReferenceLine(points: { x: number; y: number }[]): ReferenceLine | null {
  const n = points.length
  if (n < 2) {
    return null
  }

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const point of points) {
    sumX += point.x
    sumY += point.y
    sumXY += point.x * point.y
    sumXX += point.x * point.x
  }

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) {
    return null
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export type CdfPoint = { x: number; y: number }

/** Empirical cumulative distribution function. */
export function computeCdfPoints(values: number[]): CdfPoint[] {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  return sorted.map((value, index) => ({ x: value, y: (index + 1) / n }))
}
