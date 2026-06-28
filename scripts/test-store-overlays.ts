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

console.log('store-overlays: checks passed')
