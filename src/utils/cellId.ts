/*
 * Build and parse the composite key that addresses one cell of one sheet.
 * The key format is `sheetName::rowIndex::columnName`. parseCellId rejoins every segment after
 * the second, so a column name containing "::" survives a round trip. A sheet name containing
 * "::" does not, so sheet names must never use that separator.
 */
import type { CellId } from '../types/data'

export function makeCellId(
  sheetName: string,
  rowIndex: number,
  columnName: string,
): CellId {
  return `${sheetName}::${rowIndex}::${columnName}`
}

export function parseCellId(cellId: CellId) {
  const parts = cellId.split('::')
  const sheetName = parts[0] ?? ''
  const rowIndex = Number(parts[1] ?? 0)
  const columnName = parts.slice(2).join('::')

  return { sheetName, rowIndex, columnName }
}
