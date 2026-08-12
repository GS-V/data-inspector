import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type { AuditAction, CellState, WorkbookData } from '../src/types/data.ts'
import {
  buildAuditLogCsv,
  buildCleanedCsv,
  buildHighlightedXlsxWorkbookBuffer,
} from '../src/utils/exportCsv.ts'
import { makeCellId } from '../src/utils/cellId.ts'

const workbook: WorkbookData = {
  fileName: 'export-test.csv',
  sheets: [
    {
      name: 'CSV',
      columns: ['Plot', 'Yield', 'NDVI', 'Notes'],
      rows: [
        { Plot: '0012', Yield: '20', NDVI: '0.41', Notes: 'normal' },
        { Plot: '2', Yield: '100', NDVI: '0.92', Notes: 'high, quoted' },
        { Plot: '3', Yield: '', NDVI: '0.40', Notes: 'line\nbreak' },
      ],
    },
    {
      name: 'Second',
      columns: ['ID', 'Value'],
      rows: [{ ID: 'A1', Value: '1e-3' }],
    },
  ],
}

const row0Yield = makeCellId('CSV', 0, 'Yield')
const row1Yield = makeCellId('CSV', 1, 'Yield')
const row1Ndvi = makeCellId('CSV', 1, 'NDVI')
const row2Yield = makeCellId('CSV', 2, 'Yield')
const secondValue = makeCellId('Second', 0, 'Value')

const cellState: Record<string, CellState> = {
  [row0Yield]: { valueOverride: null, mark: 'blanked' },
  [row1Yield]: { mark: 'problem' },
  [row1Ndvi]: { valueOverride: 0.91, mark: 'custom', highlightColor: '#12ab34' },
  [row2Yield]: { valueOverride: 10 },
  [secondValue]: { mark: 'keep' },
}

const cleanedCsv = buildCleanedCsv(workbook.sheets[0], cellState)
const csvLines = cleanedCsv.split('\n')
assert.equal(csvLines[0], 'Plot,Yield,NDVI,Notes')
assert.equal(csvLines[1], '0012,,0.41,normal')
assert.equal(csvLines[2], '2,100,0.91,"high, quoted"')
assert.ok(cleanedCsv.includes('3,10,0.40,"line\nbreak"'))
assert.equal(cleanedCsv.includes('__mark'), false)
assert.equal(cleanedCsv.includes('reasonCategory'), false)

const auditLog: AuditAction[] = [
  {
    id: 'audit-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    groupId: 'group-1',
    actionType: 'replace_value',
    method: 'manual replacement',
    methodContext: 'Acted after preview: Value filter',
    reasonCategory: 'Data entry issue',
    reasonNote: 'Corrected from field notes',
    reason: 'Replaced selected value with 10 — Data entry issue — Corrected from field notes',
    sheetName: 'CSV',
    rowIndex: 2,
    columnName: 'Yield',
    cellId: row2Yield,
    oldValue: '',
    newValue: 10,
    oldCellState: undefined,
    newCellState: { valueOverride: 10 },
  },
]

const auditCsv = buildAuditLogCsv(auditLog)
assert.ok(auditCsv.startsWith('Timestamp,Action,Action Detail,Column,Sheet,Row / Identity,Row #,Old Value,New Value,Reason Category,Reason Note,Method,Method Context,Group ID'))
assert.ok(auditCsv.includes('Data entry issue'))
assert.ok(auditCsv.includes('Corrected from field notes'))
assert.ok(auditCsv.includes('Acted after preview: Value filter'))

const buffer = await buildHighlightedXlsxWorkbookBuffer(workbook, cellState)
const exported = new ExcelJS.Workbook()
await exported.xlsx.load(buffer)

assert.equal(exported.worksheets.length, 2)
assert.equal(exported.worksheets[0].name, 'CSV')
assert.equal(exported.worksheets[1].name, 'Second')

const sheet = exported.getWorksheet('CSV')
assert.ok(sheet)
assert.equal(sheet.getCell('A1').value, 'Plot')
assert.equal(sheet.getCell('A2').value, '0012')
assert.equal(sheet.getCell('B2').value, null)
assert.equal(sheet.getCell('B2').fill?.type, undefined)
assert.equal(sheet.getCell('B3').value, 100)
assert.equal(sheet.getCell('B3').fill?.type, 'pattern')
assert.equal(sheet.getCell('C3').value, 0.91)
assert.equal(sheet.getCell('C3').fill?.type, 'pattern')
assert.equal('fgColor' in sheet.getCell('C3').fill ? sheet.getCell('C3').fill.fgColor.argb : '', 'FF12AB34')
assert.equal(sheet.getCell('B4').value, 10)
assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), ['Plot', 'Yield', 'NDVI', 'Notes'])

const secondSheet = exported.getWorksheet('Second')
assert.ok(secondSheet)
assert.equal(secondSheet.getCell('B2').value, 0.001)
assert.equal(secondSheet.getCell('B2').fill?.type, 'pattern')
assert.deepEqual((secondSheet.getRow(1).values as unknown[]).slice(1), ['ID', 'Value'])
assert.equal(exported.getWorksheet('Audit Log'), undefined)

console.log('exports: checks passed')
