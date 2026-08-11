import ExcelJS from 'exceljs'
import type { AuditAction, AuditActionType, CellState, RawCellValue, SheetData, WorkbookData } from '../types/data'
import { makeCellId } from './cellId'
import { getDisplayValue, getEffectiveValue } from './numeric'

type FillColor = {
  argb: string
}

type PatternFill = {
  type: 'pattern'
  pattern: 'solid'
  fgColor: FillColor
}

type ExportCellValue = string | number | boolean | Date | null

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

function hexToArgb(hexColor: string): string {
  const normalized = hexColor.replace('#', '').trim()
  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    return `FF${normalized.toUpperCase()}`
  }

  return 'FFA855F7'
}

function cellFill(state?: CellState): PatternFill | undefined {
  if (state?.valueOverride === null || state?.mark === 'blanked') {
    return undefined
  }

  if (!state?.mark && state?.valueOverride !== null) {
    return undefined
  }

  if (state.mark === 'review') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF08A' } }
  }

  if (state.mark === 'problem') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFB3C1' } }
  }

  if (state.mark === 'keep') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBF7D0' } }
  }

  if (state.mark === 'custom') {
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: hexToArgb(state.highlightColor ?? '#a855f7') },
    }
  }

  return undefined
}

function isSafeNumericString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') {
    return false
  }

  const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
  if (!numericPattern.test(trimmed)) {
    return false
  }

  const withoutSign = trimmed.replace(/^[+-]/, '')
  if (/^0\d/.test(withoutSign)) {
    return false
  }

  return Number.isFinite(Number(trimmed))
}

function coerceXlsxExportCellValue(value: RawCellValue): ExportCellValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean' || value instanceof Date) {
    return value
  }

  if (typeof value === 'string') {
    if (value.trim() === '') {
      return null
    }

    if (isSafeNumericString(value)) {
      return Number(value.trim())
    }
  }

  return value
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function buildHighlightedXlsxWorkbookBuffer(
  workbookData: WorkbookData,
  cellState: Record<string, CellState>,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Data Inspector'
  workbook.created = new Date()
  workbook.modified = new Date()
  const usedSheetNames = new Set<string>()

  workbookData.sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(uniqueExcelSheetName(sheet.name, usedSheetNames))
    worksheet.addRow(sheet.columns)

    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.addRow(
        sheet.columns.map((column) => {
          const cellId = makeCellId(sheet.name, rowIndex, column)
          const value = getEffectiveValue(row[column], cellState[cellId])
          return coerceXlsxExportCellValue(value)
        }),
      )

      sheet.columns.forEach((column, columnIndex) => {
        const cellId = makeCellId(sheet.name, rowIndex, column)
        const fill = cellFill(cellState[cellId])
        if (fill) {
          excelRow.getCell(columnIndex + 1).fill = fill
        }
      })
    })
  })

  return workbook.xlsx.writeBuffer()
}

export async function downloadHighlightedXlsxWorkbook(
  fileName: string,
  workbookData: WorkbookData,
  cellState: Record<string, CellState>,
) {
  const buffer = await buildHighlightedXlsxWorkbookBuffer(workbookData, cellState)
  downloadBlob(
    fileName,
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
}

export function buildAuditLogCsv(auditLog: AuditAction[]): string {
  function actionLabel(actionType: AuditActionType, newValue?: unknown): string {
    switch (actionType) {
      case 'mark_review': return 'Flagged for review'
      case 'mark_problem': return 'Marked as problem'
      case 'mark_keep': return 'Marked as accepted'
      case 'mark_custom': return 'Custom highlight'
      case 'clear_mark': return 'Highlight removed'
      case 'blank_selected':
      case 'blank_problem':
      case 'blank_review': return 'Blanked'
      case 'replace_value':
        return newValue !== null && newValue !== undefined
          ? `Replaced with ${String(newValue)}`
          : 'Replaced'
      case 'transform_log': return 'Log transform applied'
      case 'transform_log10': return 'Log10 transform applied'
      case 'transform_sqrt': return 'Square root transform applied'
      case 'transform_boxcox': return 'Box-Cox transform applied'
      case 'transform_zscore': return 'Z-score transform applied'
      case 'undo': return 'Undone'
      default: return String(actionType)
    }
  }

  const columns = [
    'Timestamp',
    'Action',
    'Action Detail',
    'Column',
    'Sheet',
    'Row / Identity',
    'Row #',
    'Old Value',
    'New Value',
    'Reason Category',
    'Reason Note',
    'Method',
    'Method Context',
    'Group ID',
  ]

  const rows = auditLog.map((action) => ({
    Timestamp: new Date(action.timestamp).toLocaleString(),
    Action: actionLabel(action.actionType, action.newValue),
    'Action Detail': action.reason,
    Column: action.columnName,
    Sheet: action.sheetName,
    'Row / Identity': action.rowIdentifier ?? `Row ${action.rowIndex + 1}`,
    'Row #': action.rowIndex + 1,
    'Old Value': getDisplayValue(action.oldValue),
    'New Value': getDisplayValue(action.newValue),
    'Reason Category': action.reasonCategory ?? '',
    'Reason Note': action.reasonNote ?? '',
    Method: action.method,
    'Method Context': action.methodContext ?? '',
    'Group ID': action.groupId,
  }))

  return rowsToCsv(rows, columns)
}

export function downloadCsv(fileName: string, csv: string) {
  // Prepend UTF-8 BOM so Excel opens the file with correct encoding (avoids garbled non-ASCII chars)
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(fileName, blob)
}
