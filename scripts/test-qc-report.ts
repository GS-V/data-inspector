import assert from 'node:assert/strict'
import type { AuditAction, AuditActionType, CellState, SheetData, WorkbookData } from '../src/types/data.ts'
import { makeCellId } from '../src/utils/cellId.ts'
import { buildQcReport } from '../src/utils/qcReport.ts'

let checks = 0

function makeSheet(name: string, rowCount: number): SheetData {
  return {
    name,
    columns: ['value'],
    rows: Array.from({ length: rowCount }, (_, index) => ({ value: index + 1 })),
    identifierColumns: [],
  }
}

function makeWorkbook(sheets: SheetData[]): WorkbookData {
  return { fileName: 'fixture.csv', sheets }
}

function makeAction(
  overrides: Partial<AuditAction> & { actionType: AuditActionType; cellId: string; timestamp: string },
): AuditAction {
  return {
    id: `audit-${Math.random()}`,
    groupId: 'group-1',
    sheetName: 'Sheet1',
    rowIndex: 0,
    columnName: 'value',
    oldValue: null,
    newValue: null,
    method: 'test',
    reason: 'test',
    rowIdentifier: 'Row 1',
    ...overrides,
  }
}

// 1. Undo correctness: mark 3 cells review, then undo the group. The report must be built
// from current cellState (empty after undo), not by counting raw audit-log entries.
{
  const sheet = makeSheet('Sheet1', 5)
  const workbook = makeWorkbook([sheet])
  const cellIds = [0, 1, 2].map((rowIndex) => makeCellId('Sheet1', rowIndex, 'value'))
  const t = '2024-01-01T00:00:00.000Z'

  const auditLog: AuditAction[] = [
    ...cellIds.map((cellId, i) =>
      makeAction({ actionType: 'mark_review', cellId, rowIndex: i, timestamp: t }),
    ),
    ...cellIds.map((cellId, i) =>
      makeAction({ actionType: 'undo', cellId, rowIndex: i, timestamp: t }),
    ),
  ]

  const report = buildQcReport(workbook, {}, auditLog, [])
  assert.equal(report.breakdown.flagged, 0, 'undone mark_review actions must not be counted')
  checks++
}

// 2. Replace vs. transform disambiguation: both leave a bare valueOverride with no mark;
// only the audit-log provenance tells them apart.
{
  const sheet = makeSheet('Sheet1', 2)
  const workbook = makeWorkbook([sheet])
  const replacedCellId = makeCellId('Sheet1', 0, 'value')
  const transformedCellId = makeCellId('Sheet1', 1, 'value')
  const t = '2024-01-01T00:00:00.000Z'

  const cellState: Record<string, CellState> = {
    [replacedCellId]: { valueOverride: 99 },
    [transformedCellId]: { valueOverride: 5 },
  }
  const auditLog: AuditAction[] = [
    makeAction({ actionType: 'replace_value', cellId: replacedCellId, rowIndex: 0, timestamp: t }),
    makeAction({ actionType: 'transform_log', cellId: transformedCellId, rowIndex: 1, timestamp: t }),
  ]

  const report = buildQcReport(workbook, cellState, auditLog, [])
  assert.equal(report.breakdown.replaced, 1, 'only the replace_value cell should count as replaced')
  assert.equal(report.affectedRows, 1, 'the transformed row must not count as data loss')
  checks++
}

// 3. Highlight-only marks (no value change) are not data loss.
{
  const sheet = makeSheet('Sheet1', 3)
  const workbook = makeWorkbook([sheet])
  const cellId = makeCellId('Sheet1', 0, 'value')
  const t = '2024-01-01T00:00:00.000Z'

  const cellState: Record<string, CellState> = { [cellId]: { mark: 'keep' } }
  const auditLog: AuditAction[] = [makeAction({ actionType: 'mark_keep', cellId, rowIndex: 0, timestamp: t })]

  const report = buildQcReport(workbook, cellState, auditLog, [])
  assert.equal(report.breakdown.accepted, 1)
  assert.equal(report.affectedRows, 0, 'a keep mark with no value change is not data loss')
  checks++
}

// 4. A blanked cell counts as affected/data-loss.
{
  const sheet = makeSheet('Sheet1', 10)
  const workbook = makeWorkbook([sheet])
  const cellId = makeCellId('Sheet1', 0, 'value')
  const t = '2024-01-01T00:00:00.000Z'

  const cellState: Record<string, CellState> = { [cellId]: { mark: 'blanked', valueOverride: null } }
  const auditLog: AuditAction[] = [
    makeAction({ actionType: 'blank_selected', cellId, rowIndex: 0, timestamp: t }),
  ]

  const report = buildQcReport(workbook, cellState, auditLog, [])
  assert.equal(report.affectedRows, 1)
  assert.equal(report.keptRowRatio, 0.9)
  checks++
}

// 5. Multi-sheet aggregation: one blanked cell per sheet.
{
  const sheetA = makeSheet('SheetA', 5)
  const sheetB = makeSheet('SheetB', 5)
  const workbook = makeWorkbook([sheetA, sheetB])
  const cellIdA = makeCellId('SheetA', 0, 'value')
  const cellIdB = makeCellId('SheetB', 0, 'value')
  const t = '2024-01-01T00:00:00.000Z'

  const cellState: Record<string, CellState> = {
    [cellIdA]: { mark: 'blanked', valueOverride: null },
    [cellIdB]: { mark: 'blanked', valueOverride: null },
  }
  const auditLog: AuditAction[] = [
    makeAction({ actionType: 'blank_selected', cellId: cellIdA, sheetName: 'SheetA', rowIndex: 0, timestamp: t }),
    makeAction({ actionType: 'blank_selected', cellId: cellIdB, sheetName: 'SheetB', rowIndex: 0, timestamp: t }),
  ]

  const report = buildQcReport(workbook, cellState, auditLog, [])
  assert.equal(report.sheetSummaries.length, 2)
  assert.equal(report.sheetSummaries[0].affectedRows, 1)
  assert.equal(report.sheetSummaries[1].affectedRows, 1)
  assert.equal(report.affectedRows, 2)
  checks++
}

// 6. Empty audit log / empty cellState must not crash and must not produce NaN.
{
  const sheet = makeSheet('Sheet1', 4)
  const workbook = makeWorkbook([sheet])
  const report = buildQcReport(workbook, {}, [], [])

  assert.deepEqual(report.breakdown, {
    flagged: 0,
    problem: 0,
    accepted: 0,
    custom: 0,
    blanked: 0,
    replaced: 0,
    imputed: 0,
  })
  assert.equal(report.keptRowRatio, 1)
  checks++
}

console.log(`qc-report: ${checks} checks passed`)
