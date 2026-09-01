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
 * A column counts as numeric if at least `minimumNumericRatio` (default 50%) of its
 * non-empty values parse as numbers — a threshold rather than "all values," so a handful
 * of stray text entries (typos, "N/A") don't disqualify an otherwise numeric column.
 * A column with zero non-empty values is treated as not numeric rather than dividing by zero.
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
 * Numeric columns suitable for being a plotted VALUE (Y-axis, comparison overlay) -- numeric
 * per findNumericColumns, with date columns excluded. A date is an axis dimension, not a value:
 * toNumber() converts it to a valid epoch-ms number, so it would otherwise pass the numeric check.
 */
export function findValueColumns(rows: RowData[], columns: string[]): string[] {
  return findNumericColumns(rows, columns).filter((column) => !isDateCol(column, rows))
}

export function findIdentifierColumns(
  rows: RowData[],
  columns: string[],
): string[] {
  const numericSet = new Set(findNumericColumns(rows, columns))
  // Date columns are classified as numeric by toNumber() (returns timestamp ms),
  // but they are human-readable identifiers — include them regardless.
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
