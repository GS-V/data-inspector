import * as XLSX from 'xlsx'
import type { AuditAction, CellState, RawCellValue, SheetData, WorkbookData } from '../types/data'
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

function cleanedSheetRows(sheet: SheetData, cellState: Record<string, CellState>) {
  return sheet.rows.map((row, rowIndex) =>
    sheet.columns.map((column) => {
      const cellId = makeCellId(sheet.name, rowIndex, column)
      const value = getEffectiveValue(row[column], cellState[cellId])
      return value ?? ''
    }),
  )
}

function uniqueExcelSheetName(sheetName: string, usedNames: Set<string>) {
  const baseName = (sheetName.trim() || 'Sheet').slice(0, 31)
  let nextName = baseName
  let suffix = 2

  while (usedNames.has(nextName)) {
    const suffixText = ` ${suffix}`
    nextName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`
    suffix += 1
  }

  usedNames.add(nextName)
  return nextName
}

export function downloadCleanedXlsxWorkbook(
  fileName: string,
  workbookData: WorkbookData,
  cellState: Record<string, CellState>,
) {
  const workbook = XLSX.utils.book_new()
  const usedSheetNames = new Set<string>()

  workbookData.sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.columns, ...cleanedSheetRows(sheet, cellState)])
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueExcelSheetName(sheet.name, usedSheetNames))
  })

  XLSX.writeFile(workbook, fileName)
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
