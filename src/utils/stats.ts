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
