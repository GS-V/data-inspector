import type { AuditAction, CellState, RawCellValue, SheetData } from '../types/data'
import { makeCellId } from './cellId'
import { getDisplayValue, getEffectiveValue } from './numeric'

function escapeCsvValue(value: RawCellValue): string {
  const text = getDisplayValue(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function rowsToCsv(rows: Record<string, RawCellValue>[], columns: string[]): string {
  const header = columns.map(escapeCsvValue).join(',')
  const body = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(','))
  return [header, ...body].join('\n')
}

export function buildCleanedCsv(
  sheet: SheetData,
  cellState: Record<string, CellState>,
): string {
  const rows = sheet.rows.map((row, rowIndex) => {
    const cleanedRow: Record<string, RawCellValue> = {}
    sheet.columns.forEach((column) => {
      const cellId = makeCellId(sheet.name, rowIndex, column)
      cleanedRow[column] = getEffectiveValue(row[column], cellState[cellId])
    })
    return cleanedRow
  })

  return rowsToCsv(rows, sheet.columns)
}

export function buildMarkedCsv(
  sheet: SheetData,
  selectedColumn: string,
  cellState: Record<string, CellState>,
): string {
  const markColumn = `${selectedColumn}__mark`
  const noteColumn = `${selectedColumn}__note`
  const markedCellsColumn = '__marked_cells'
  const markSummaryColumn = '__mark_summary'
  const blankedCellsColumn = '__blanked_cells'
  const columns = [
    ...sheet.columns,
    markColumn,
    noteColumn,
    markedCellsColumn,
    markSummaryColumn,
    blankedCellsColumn,
  ]
  const rows = sheet.rows.map((row, rowIndex) => {
    const markedRow: Record<string, RawCellValue> = {}
    const markedCells: string[] = []
    const summaryItems: string[] = []
    const blankedCells: string[] = []

    sheet.columns.forEach((column) => {
      const cellId = makeCellId(sheet.name, rowIndex, column)
      const state = cellState[cellId]
      markedRow[column] = getEffectiveValue(row[column], state)

      if (state?.mark || state?.valueOverride === null) {
        const mark = state.valueOverride === null ? 'blanked' : (state.mark ?? 'changed')
        markedCells.push(`${column}=${mark}`)
        summaryItems.push(`${column} ${mark}`)
      }

      if (state?.valueOverride === null || state?.mark === 'blanked') {
        blankedCells.push(column)
        if (!summaryItems.includes(`${column} blanked`)) {
          summaryItems.push(`${column} blanked`)
        }
      }
    })

    const inspectedCellId = makeCellId(sheet.name, rowIndex, selectedColumn)
    markedRow[markColumn] = cellState[inspectedCellId]?.mark ?? ''
    markedRow[noteColumn] = cellState[inspectedCellId]?.note ?? ''
    markedRow[markedCellsColumn] = markedCells.join('; ')
    markedRow[blankedCellsColumn] = blankedCells.join('; ')
    markedRow[markSummaryColumn] =
      summaryItems.length === 0
        ? ''
        : `${summaryItems.length} marked/blanked cell${summaryItems.length === 1 ? '' : 's'}: ${summaryItems.join('; ')}`
    return markedRow
  })

  return rowsToCsv(rows, columns)
}

export function buildAuditLogCsv(auditLog: AuditAction[]): string {
  const columns = [
    'id',
    'timestamp',
    'groupId',
    'actionType',
    'sheetName',
    'rowIndex',
    'columnName',
    'cellId',
    'oldValue',
    'newValue',
    'oldCellState',
    'newCellState',
    'method',
    'reason',
  ]

  const rows = auditLog.map((action) => ({
    ...action,
    oldValue: getDisplayValue(action.oldValue),
    newValue: getDisplayValue(action.newValue),
    oldCellState: action.oldCellState ? JSON.stringify(action.oldCellState) : '',
    newCellState: action.newCellState ? JSON.stringify(action.newCellState) : '',
  }))

  return rowsToCsv(rows, columns)
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
