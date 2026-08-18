import type {
  AuditAction,
  AuditActionType,
  CellState,
  DistributionSummary,
  NormalityTestResult,
  NormalityTestType,
  SheetData,
  TransformAttempt,
  WorkbookData,
} from '../types/data'
import { makeCellId, parseCellId } from './cellId'
import { getColumnNumbers, summarizeNumbers } from './stats'
import { calculateSkewness, runNormalityTest } from './transforms'

// Matches the store's normalityTestType/normalityThreshold defaults (useDataInspectorStore.ts) --
// the QC report always reports against this fixed default rather than whatever test the user
// currently has selected in the Transform tools, so the report's verdicts stay reproducible
// independent of in-session UI state.
const QC_NORMALITY_TEST_TYPE: NormalityTestType = 'shapiro-wilk'
const QC_NORMALITY_THRESHOLD = 0.05

export type QcActionBreakdown = {
  flagged: number
  problem: number
  accepted: number
  custom: number
  blanked: number
  replaced: number
  imputed: number
}

export type QcColumnStat = {
  sheetName: string
  columnName: string
  before: DistributionSummary
  after: DistributionSummary
  skewnessBefore: number | null
  skewnessAfter: number | null
  // null means "not run" (column has no transform history), distinct from a NormalityTestResult
  // whose own statistic/pValue are null because the sample was too small for the test.
  normalityBefore: NormalityTestResult | null
  normalityAfter: NormalityTestResult | null
}

export type QcSheetSummary = {
  sheetName: string
  totalRows: number
  affectedRows: number
  keptRowRatio: number // 0..1; NaN-safe (0 rows -> 1)
}

export type QcReport = {
  generatedAt: string
  fileName: string
  breakdown: QcActionBreakdown
  sheetSummaries: QcSheetSummary[]
  totalRows: number
  affectedRows: number
  keptRowRatio: number
  columnStats: QcColumnStat[]
  normalityTestType: NormalityTestType
  normalityThreshold: number
}

/**
 * For cells whose current CellState has a non-null valueOverride but no `mark` (this is the
 * exact footprint left by BOTH a manual "Replace selected with new value" action AND any
 * transform — CellState alone cannot tell them apart), reconstruct which action type is
 * actually responsible for the cell's current value.
 *
 * Walks the append-only audit log once, maintaining a per-cell stack of applied (non-undo)
 * action types and popping on 'undo'. This mirrors the store's real undo semantics exactly:
 * undoLastActionGroup only ever reverts the most recently applied group, one action per cell
 * per group, so a LIFO stack per cellId is the correct model of "what's currently in effect."
 */
export function resolveAmbiguousProvenance(
  targetCellIds: Set<string>,
  auditLog: AuditAction[],
): Map<string, AuditActionType | undefined> {
  const stacks = new Map<string, AuditActionType[]>()

  auditLog.forEach((action) => {
    if (!targetCellIds.has(action.cellId)) {
      return
    }
    const stack = stacks.get(action.cellId) ?? []
    if (action.actionType === 'undo') {
      stack.pop()
    } else {
      stack.push(action.actionType)
    }
    stacks.set(action.cellId, stack)
  })

  const result = new Map<string, AuditActionType | undefined>()
  targetCellIds.forEach((cellId) => {
    const stack = stacks.get(cellId) ?? []
    result.set(cellId, stack[stack.length - 1])
  })
  return result
}

function computeSheetBreakdownAndLoss(
  sheet: SheetData,
  cellState: Record<string, CellState>,
  auditLog: AuditAction[],
): { breakdown: QcActionBreakdown; affectedRows: number } {
  const breakdown: QcActionBreakdown = {
    flagged: 0,
    problem: 0,
    accepted: 0,
    custom: 0,
    blanked: 0,
    replaced: 0,
    imputed: 0,
  }
  const ambiguousCellIds = new Set<string>()
  const rowAffected = new Array<boolean>(sheet.rows.length).fill(false)

  sheet.rows.forEach((_row, rowIndex) => {
    sheet.columns.forEach((column) => {
      const cellId = makeCellId(sheet.name, rowIndex, column)
      const state = cellState[cellId]
      if (!state) {
        return
      }

      if (state.mark === 'review') breakdown.flagged += 1
      else if (state.mark === 'problem') breakdown.problem += 1
      else if (state.mark === 'keep') breakdown.accepted += 1
      else if (state.mark === 'custom') breakdown.custom += 1
      else if (state.mark === 'imputed') {
        breakdown.imputed += 1
        rowAffected[rowIndex] = true
      }

      const isBlanked = state.mark === 'blanked' || state.valueOverride === null
      if (isBlanked) {
        breakdown.blanked += 1
        rowAffected[rowIndex] = true
        return
      }

      const hasRealOverride =
        Object.prototype.hasOwnProperty.call(state, 'valueOverride') && state.valueOverride !== null
      if (hasRealOverride && !state.mark) {
        ambiguousCellIds.add(cellId)
      }
    })
  })

  const provenance = resolveAmbiguousProvenance(ambiguousCellIds, auditLog)
  ambiguousCellIds.forEach((cellId) => {
    if (provenance.get(cellId) === 'replace_value') {
      breakdown.replaced += 1
      rowAffected[parseCellId(cellId).rowIndex] = true
    }
    // transform_* provenance: intentionally excluded from cleaning breakdown / data loss.
  })

  const affectedRows = rowAffected.filter(Boolean).length
  return { breakdown, affectedRows }
}

function mergeBreakdown(a: QcActionBreakdown, b: QcActionBreakdown): QcActionBreakdown {
  return {
    flagged: a.flagged + b.flagged,
    problem: a.problem + b.problem,
    accepted: a.accepted + b.accepted,
    custom: a.custom + b.custom,
    blanked: a.blanked + b.blanked,
    replaced: a.replaced + b.replaced,
    imputed: a.imputed + b.imputed,
  }
}

function buildColumnStats(
  sheet: SheetData,
  cellState: Record<string, CellState>,
  transformedColumnKeys: Set<string>,
): QcColumnStat[] {
  return sheet.columns
    .map((columnName) => {
      const beforeNumbers = getColumnNumbers(sheet.rows, sheet.name, columnName, {})
      const afterNumbers = getColumnNumbers(sheet.rows, sheet.name, columnName, cellState)
      const before = summarizeNumbers(beforeNumbers.values, beforeNumbers.missingCount)
      const after = summarizeNumbers(afterNumbers.values, afterNumbers.missingCount)
      // Skip columns with no numeric values at all (e.g. pure text/identifier columns) --
      // a before/after row of all dashes is noise, not information.
      if (before.count === 0 && after.count === 0) {
        return null
      }

      // Only run normality tests on columns the user actually transformed -- running it on
      // every numeric column in a large sheet would be surprising, uninvited computation.
      const hasTransform = transformedColumnKeys.has(`${sheet.name}::${columnName}`)

      return {
        sheetName: sheet.name,
        columnName,
        before,
        after,
        skewnessBefore: calculateSkewness(beforeNumbers.values),
        skewnessAfter: calculateSkewness(afterNumbers.values),
        normalityBefore: hasTransform ? runNormalityTest(beforeNumbers.values, QC_NORMALITY_TEST_TYPE) : null,
        normalityAfter: hasTransform ? runNormalityTest(afterNumbers.values, QC_NORMALITY_TEST_TYPE) : null,
      }
    })
    .filter((entry): entry is QcColumnStat => entry !== null)
}

export function buildQcReport(
  workbook: WorkbookData,
  cellState: Record<string, CellState>,
  auditLog: AuditAction[],
  transformHistory: TransformAttempt[],
): QcReport {
  const transformedColumnKeys = new Set(
    transformHistory.flatMap((attempt) => attempt.columns.map((columnName) => `${attempt.sheetName}::${columnName}`)),
  )

  let breakdown: QcActionBreakdown = {
    flagged: 0,
    problem: 0,
    accepted: 0,
    custom: 0,
    blanked: 0,
    replaced: 0,
    imputed: 0,
  }
  let totalRows = 0
  let affectedRows = 0
  const sheetSummaries: QcSheetSummary[] = []
  const columnStats: QcColumnStat[] = []

  workbook.sheets.forEach((sheet) => {
    const { breakdown: sheetBreakdown, affectedRows: sheetAffected } = computeSheetBreakdownAndLoss(
      sheet,
      cellState,
      auditLog,
    )
    breakdown = mergeBreakdown(breakdown, sheetBreakdown)
    totalRows += sheet.rows.length
    affectedRows += sheetAffected
    sheetSummaries.push({
      sheetName: sheet.name,
      totalRows: sheet.rows.length,
      affectedRows: sheetAffected,
      keptRowRatio: sheet.rows.length === 0 ? 1 : 1 - sheetAffected / sheet.rows.length,
    })
    columnStats.push(...buildColumnStats(sheet, cellState, transformedColumnKeys))
  })

  return {
    generatedAt: new Date().toISOString(),
    fileName: workbook.fileName,
    breakdown,
    sheetSummaries,
    totalRows,
    affectedRows,
    keptRowRatio: totalRows === 0 ? 1 : 1 - affectedRows / totalRows,
    columnStats,
    normalityTestType: QC_NORMALITY_TEST_TYPE,
    normalityThreshold: QC_NORMALITY_THRESHOLD,
  }
}
