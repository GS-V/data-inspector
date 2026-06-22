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
