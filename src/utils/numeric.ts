import type { CellState, RawCellValue, RowData } from '../types/data'

export function isMissing(value: RawCellValue): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export function toNumber(value: RawCellValue): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean' || isMissing(value)) {
    return null
  }

  const normalized = String(value).replace(/,/g, '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function getEffectiveValue(
  rawValue: RawCellValue,
  state?: CellState,
): RawCellValue {
  if (!state || !Object.prototype.hasOwnProperty.call(state, 'valueOverride')) {
    return rawValue
  }

  return state.valueOverride
}

export function getDisplayValue(value: RawCellValue): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return String(value)
}

export function findNumericColumns(
  rows: RowData[],
  columns: string[],
  minimumNumericRatio = 0.6,
): string[] {
  return columns.filter((column) => {
    let nonEmptyValues = 0
    let numericValues = 0

    for (const row of rows) {
      const value = row[column]
      if (isMissing(value)) {
        continue
      }

      nonEmptyValues += 1
      if (toNumber(value) !== null) {
        numericValues += 1
      }
    }

    if (nonEmptyValues === 0) {
      return false
    }

    return numericValues / nonEmptyValues >= minimumNumericRatio
  })
}

