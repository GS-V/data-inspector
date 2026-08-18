import assert from 'node:assert/strict'
import { useDataInspectorStore } from '../src/store/useDataInspectorStore.ts'
import type { WorkbookData } from '../src/types/data.ts'
import { hasCompleteAuditReason } from '../src/utils/auditReason.ts'
import { makeCellId } from '../src/utils/cellId.ts'
import { getEffectiveValue } from '../src/utils/numeric.ts'

const workbook: WorkbookData = {
  fileName: 'store-test.csv',
  sheets: [
    {
      name: 'CSV',
      columns: ['Plot', 'Yield', 'Notes'],
      rows: [
        { Plot: 1, Yield: 20, Notes: 'normal' },
        { Plot: 2, Yield: 100, Notes: 'high' },
        { Plot: 3, Yield: '', Notes: 'missing yield' },
      ],
    },
  ],
}

const reason = {
  reasonCategory: 'Data entry issue',
  reasonNote: 'Corrected during review',
}

useDataInspectorStore.getState().setWorkbook(workbook)
const store = useDataInspectorStore.getState()
const row0Yield = makeCellId('CSV', 0, 'Yield')
const row1Yield = makeCellId('CSV', 1, 'Yield')
const row2Yield = makeCellId('CSV', 2, 'Yield')

assert.equal(hasCompleteAuditReason('', 'note'), false)
assert.equal(hasCompleteAuditReason('Data entry issue', ''), false)
assert.equal(hasCompleteAuditReason('Data entry issue', '  '), false)
assert.equal(hasCompleteAuditReason('Data entry issue', 'Corrected'), true)

store.toggleSelectedCell(row0Yield)
store.markTargets('review')
let state = useDataInspectorStore.getState()
assert.equal(state.cellState[row0Yield]?.mark, 'review')
assert.equal(state.auditLog.at(-1)?.actionType, 'mark_review')

state.clearSelection()
state.toggleSelectedCell(row1Yield)
state.markTargets('custom', '#12ab34')
state = useDataInspectorStore.getState()
assert.equal(state.cellState[row1Yield]?.mark, 'custom')
assert.equal(state.cellState[row1Yield]?.highlightColor, '#12ab34')

state.clearTargetMarks()
state = useDataInspectorStore.getState()
assert.equal(state.cellState[row1Yield], undefined)
assert.equal(state.auditLog.at(-1)?.actionType, 'clear_mark')

state.clearSelection()
state.addSelectedCells([row0Yield, row1Yield])
state.blankSelectedTargets(reason)
state = useDataInspectorStore.getState()
const blankActions = state.auditLog.slice(-2)
assert.equal(blankActions.length, 2)
assert.equal(blankActions[0].actionType, 'blank_selected')
assert.equal(blankActions[1].actionType, 'blank_selected')
assert.equal(blankActions[0].groupId, blankActions[1].groupId)
assert.equal(blankActions[0].reasonCategory, reason.reasonCategory)
assert.equal(blankActions[1].reasonNote, reason.reasonNote)
assert.equal(state.cellState[row0Yield]?.valueOverride, null)
assert.equal(state.cellState[row0Yield]?.mark, 'blanked')

state.clearSelection()
state.toggleSelectedCell(row0Yield)
state.replaceSelectedTargets(10, {
  reasonCategory: 'Measurement error',
  reasonNote: 'Blank was replaced with corrected value',
})
state = useDataInspectorStore.getState()
assert.equal(state.cellState[row0Yield]?.valueOverride, 10)
assert.equal(state.cellState[row0Yield]?.mark, undefined)
assert.equal(getEffectiveValue(workbook.sheets[0].rows[0].Yield, state.cellState[row0Yield]), 10)
assert.equal(workbook.sheets[0].rows[0].Yield, 20)
assert.equal(state.auditLog.at(-1)?.actionType, 'replace_value')
assert.equal(state.auditLog.at(-1)?.oldValue, null)
assert.equal(state.auditLog.at(-1)?.newValue, 10)

state.undoLastActionGroup()
state = useDataInspectorStore.getState()
assert.equal(state.cellState[row0Yield]?.valueOverride, null)
assert.equal(state.cellState[row0Yield]?.mark, 'blanked')
assert.equal(state.auditLog.at(-1)?.actionType, 'undo')

state.clearSelection()
state.toggleSelectedCell(row2Yield)
state.replaceSelectedTargets('not numeric', reason)
state = useDataInspectorStore.getState()
assert.equal(state.cellState[row2Yield]?.valueOverride, 'not numeric')
assert.equal(state.auditLog.at(-1)?.reason, 'Replaced selected value with not numeric — Data entry issue — Corrected during review')

// Imputation: mean, median, and linear interpolation (including the no-neighbor edge case).
const imputeWorkbook: WorkbookData = {
  fileName: 'impute-test.csv',
  sheets: [
    {
      name: 'Sheet1',
      columns: ['Value'],
      rows: [
        { Value: 10 }, // 0
        { Value: '' }, // 1 -- between 10 and 30
        { Value: 30 }, // 2
        { Value: '' }, // 3 -- between 30 and 60
        { Value: '' }, // 4 -- between 30 and 60
        { Value: 60 }, // 5
        { Value: '' }, // 6 -- trailing edge, no neighbor below
      ],
    },
  ],
}
const valueCell = (rowIndex: number) => makeCellId('Sheet1', rowIndex, 'Value')

useDataInspectorStore.getState().setWorkbook(imputeWorkbook)
useDataInspectorStore.getState().setSelectedColumn('Value')
let imputeResult = useDataInspectorStore.getState().imputeMissingValues('mean', reason)
state = useDataInspectorStore.getState()
assert.equal(imputeResult.appliedCount, 4, 'mean fill applies to all 4 missing cells')
assert.equal(imputeResult.skippedCount, 0)
assert.equal(Math.round(Number(state.cellState[valueCell(1)]?.valueOverride) * 100) / 100, 33.33)
assert.equal(state.cellState[valueCell(1)]?.mark, 'imputed')
assert.equal(state.auditLog.at(-1)?.actionType, 'impute_mean')
assert.ok(state.auditLog.at(-1)?.reason.startsWith('Filled with column mean ('))

useDataInspectorStore.getState().setWorkbook(imputeWorkbook)
useDataInspectorStore.getState().setSelectedColumn('Value')
imputeResult = useDataInspectorStore.getState().imputeMissingValues('median', reason)
state = useDataInspectorStore.getState()
assert.equal(imputeResult.appliedCount, 4)
assert.equal(state.cellState[valueCell(1)]?.valueOverride, 30, 'median of [10, 30, 60] is 30')

useDataInspectorStore.getState().setWorkbook(imputeWorkbook)
useDataInspectorStore.getState().setSelectedColumn('Value')
imputeResult = useDataInspectorStore.getState().imputeMissingValues('interpolate', reason)
state = useDataInspectorStore.getState()
assert.equal(imputeResult.appliedCount, 3, 'rows 1, 3, 4 interpolate between their neighbors')
assert.equal(imputeResult.skippedCount, 1, 'row 6 has no neighbor below and is skipped, not guessed')
assert.equal(state.cellState[valueCell(1)]?.valueOverride, 20)
assert.equal(Math.round(Number(state.cellState[valueCell(3)]?.valueOverride) * 100) / 100, 40)
assert.equal(Math.round(Number(state.cellState[valueCell(4)]?.valueOverride) * 100) / 100, 50)
assert.equal(state.cellState[valueCell(6)], undefined, 'skipped cell is left completely untouched')
assert.equal(state.auditLog.at(-1)?.actionType, 'impute_interpolate')

// A cell that already carries a different mark is overwritten to 'imputed', since the value itself changed.
useDataInspectorStore.getState().setWorkbook(imputeWorkbook)
useDataInspectorStore.getState().setSelectedColumn('Value')
useDataInspectorStore.getState().toggleSelectedCell(valueCell(1))
useDataInspectorStore.getState().markTargets('review')
useDataInspectorStore.getState().clearSelection()
useDataInspectorStore.getState().imputeMissingValues('mean', reason)
state = useDataInspectorStore.getState()
assert.equal(state.cellState[valueCell(1)]?.mark, 'imputed', 'imputing overwrites a prior review/problem/keep mark')

// A column with zero non-missing values has nothing to compute mean/median/interpolation from.
const emptyColumnWorkbook: WorkbookData = {
  fileName: 'impute-empty.csv',
  sheets: [{ name: 'Sheet1', columns: ['Value'], rows: [{ Value: '' }, { Value: '' }] }],
}
useDataInspectorStore.getState().setWorkbook(emptyColumnWorkbook)
useDataInspectorStore.getState().setSelectedColumn('Value')
imputeResult = useDataInspectorStore.getState().imputeMissingValues('mean', reason)
assert.equal(imputeResult.appliedCount, 0)
assert.equal(imputeResult.skippedCount, 2)

console.log('store-overlays: checks passed')
