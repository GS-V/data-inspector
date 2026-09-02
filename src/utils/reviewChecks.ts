/*
 * Detection rules that suggest cells for review: repeated values and percentile bounds.
 * Pure functions -- no React, no Zustand, no cell state. Callers resolve effective values first.
 * These functions only suggest cells. They never change data.
 */
import type { RawCellValue } from '../types/data'

export type PercentileBounds = {
  lowerValue: number
  upperValue: number
}

function isBlank(value: RawCellValue): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export function duplicateValueKeys(values: RawCellValue[]): Set<string> {
  const counts = new Map<string, number>()

  values.forEach((value) => {
    if (isBlank(value)) {
      return
    }

    const key = String(value).trim()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  )
}

export function isValidPercentileRange(lowerPercentile: number, upperPercentile: number): boolean {
  return (
    Number.isFinite(lowerPercentile) &&
    Number.isFinite(upperPercentile) &&
    lowerPercentile >= 0 &&
    lowerPercentile < upperPercentile &&
    upperPercentile <= 100
  )
}

export function percentileValue(sortedValues: number[], percentile: number): number | null {
  if (sortedValues.length === 0) {
    return null
  }

  if (sortedValues.length === 1) {
    return sortedValues[0]
  }

  const position = (percentile / 100) * (sortedValues.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const weight = position - lowerIndex

  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight
}

export function percentileBounds(
  values: number[],
  lowerPercentile: number,
  upperPercentile: number,
): PercentileBounds | null {
  if (!isValidPercentileRange(lowerPercentile, upperPercentile)) {
    return null
  }

  const sortedValues = values.filter(Number.isFinite).sort((first, second) => first - second)
  const lowerValue = percentileValue(sortedValues, lowerPercentile)
  const upperValue = percentileValue(sortedValues, upperPercentile)

  if (lowerValue === null || upperValue === null) {
    return null
  }

  return { lowerValue, upperValue }
}
