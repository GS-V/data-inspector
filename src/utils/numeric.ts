/*
 * Value coercion and column classification shared by every reader of sheet data.
 * Pure functions -- no React, no Zustand, no browser APIs.
 * getEffectiveValue is the only place that resolves a raw cell against its overlay. Always read a
 * cell through it. Reading straight from the row silently ignores every user edit.
 */
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

/**
 * Return the columns that count as numeric.
 * A column qualifies when at least `minimumNumericRatio` of its non-empty values parse as
 * numbers. The default is 50%. Use a ratio rather than "every value". A few stray text entries,
 * such as a typo or an "N/A", then do not disqualify an otherwise numeric column.
 * Treat a column with no non-empty values as not numeric, rather than dividing by zero.
 */
export function findNumericColumns(
  rows: RowData[],
  columns: string[],
  minimumNumericRatio = 0.5,
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

export function isDateCol(col: string, rows: RowData[]): boolean {
  return rows.some((row) => row[col] instanceof Date)
}

/**
 * Return the columns usable as a plotted value, meaning a Y-axis or a comparison overlay.
 * These are the findNumericColumns results with every date column removed. A date is an axis
 * dimension, not a value. Exclude dates explicitly, because toNumber() turns a date into a valid
 * epoch-millisecond number, so a date column would otherwise pass the numeric check.
 */
export function findValueColumns(rows: RowData[], columns: string[]): string[] {
  return findNumericColumns(rows, columns).filter((column) => !isDateCol(column, rows))
}

export function findIdentifierColumns(
  rows: RowData[],
  columns: string[],
): string[] {
  const numericSet = new Set(findNumericColumns(rows, columns))
  // toNumber() turns a date into epoch milliseconds, so findNumericColumns counts date columns
  // as numeric. Add them back anyway. A date reads as a human-readable identifier.
  return columns.filter((col) => !numericSet.has(col) || isDateCol(col, rows)).slice(0, 3)
}

export function buildRowIdentifier(
  row: RowData,
  rowIndex: number,
  identifierColumns: string[],
  oldValue: RawCellValue,
): string {
  if (identifierColumns.length > 0) {
    const parts = identifierColumns
      .map((col) => {
        const val = row[col]
        if (val instanceof Date) {
          return val.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        }
        const str = val !== null && val !== undefined ? String(val).trim() : ''
        return str || null
      })
      .filter((v): v is string => v !== null)
    if (parts.length > 0) return parts.join(' · ')
  }
  const oldStr =
    oldValue !== null && oldValue !== undefined && String(oldValue).trim()
      ? ` · was ${String(oldValue).trim()}`
      : ''
  return `Row ${rowIndex + 1}${oldStr}`
}
