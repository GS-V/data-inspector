/*
 * Parse a local CSV or XLSX file into the WorkbookData shape the store expects.
 * The file never leaves the browser. PapaParse and SheetJS both read the local File object.
 * Column names are made unique and non-empty here, because every cell key depends on a stable
 * column name for the whole session.
 */
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { findIdentifierColumns } from './numeric'
import type { RowData, SheetData, WorkbookData } from '../types/data'

function uniqueColumns(columns: string[]): string[] {
  const seen = new Map<string, number>()
  return columns.map((column, index) => {
    const fallback = column.trim() || `Column ${index + 1}`
    const count = seen.get(fallback) ?? 0
    seen.set(fallback, count + 1)
    return count === 0 ? fallback : `${fallback}_${count + 1}`
  })
}

function normalizeRows(rows: RowData[], columns: string[]): RowData[] {
  return rows.map((row) => {
    const normalized: RowData = {}
    columns.forEach((column) => {
      normalized[column] = row[column] ?? ''
    })
    return normalized
  })
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

async function parseCsv(file: File): Promise<WorkbookData> {
  const parsed = await new Promise<Papa.ParseResult<RowData>>((resolve, reject) => {
    Papa.parse<RowData>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (header) => header.trim(),
      transform: (value) => (typeof value === 'string' ? value.trim() : value),
      complete: resolve,
      error: reject,
    })
  })

  const columns = uniqueColumns((parsed.meta.fields ?? []).filter((field) => field.trim() !== ''))
  const rows = normalizeRows(parsed.data, columns)

  if (columns.length === 0) {
    throw new Error('CSV could not be loaded because no usable columns were found.')
  }

  if (rows.length === 0) {
    throw new Error('CSV could not be loaded because no usable rows were found.')
  }

  const parseWarnings = parsed.errors.map((error) => {
    const rowText = typeof error.row === 'number' ? ` Row ${error.row + 2}.` : ''
    return `${error.message}${rowText}`
  })

  const csvIdentifierColumns = findIdentifierColumns(rows, columns)
  return {
    fileName: file.name,
    sheets: [{ name: 'CSV', columns, rows, identifierColumns: csvIdentifierColumns }],
    parseWarnings,
  }
}

async function parseXlsx(file: File): Promise<WorkbookData> {
  const buffer = await readAsArrayBuffer(file)
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets: SheetData[] = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName]
    const rowsAsArrays = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(
      worksheet,
      {
        header: 1,
        defval: '',
        raw: true,
      },
    )

    const headerRow = rowsAsArrays[0] ?? []
    const columns = uniqueColumns(headerRow.map((value, index) => String(value || `Column ${index + 1}`)))
    const rows = rowsAsArrays.slice(1).map((values) => {
      const row: RowData = {}
      columns.forEach((column, index) => {
        row[column] = values[index] ?? ''
      })
      return row
    })

    const identifierColumns = findIdentifierColumns(rows, columns)
    return { name: sheetName, columns, rows, identifierColumns }
  })

  return { fileName: file.name, sheets }
}

export async function parseLocalFile(file: File): Promise<WorkbookData> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.csv')) {
    return parseCsv(file)
  }

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    return parseXlsx(file)
  }

  throw new Error('Please choose a CSV or XLSX file.')
}
