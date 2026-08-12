import type {
  AuditAction,
  AuditActionType,
  CellState,
  DistributionSummary,
  SheetData,
  WorkbookData,
} from '../types/data'
import { makeCellId, parseCellId } from './cellId'
import { summarizeColumn } from './stats'

// Action types that represent a QC "cleaning" decision (highlighting, blanking, manual
// replacement). Deliberately excludes transform_* (separate feature, own reporting in
// TransformHistoryPanel) and 'undo' (only ever shown in the timeline, never in totals —
// totals are always derived from current cellState, which already reflects any undo).
export const CLEANING_ACTION_TYPES: AuditActionType[] = [
  'mark_review',
  'mark_problem',
  'mark_keep',
  'mark_custom',
  'clear_mark',
  'blank_selected',
  'blank_problem',
  'blank_review',
  'replace_value',
]

export type QcActionBreakdown = {
  flagged: number
  problem: number
  accepted: number
  custom: number
  blanked: number
  replaced: number
}

export type QcColumnStat = {
  sheetName: string
  columnName: string
  before: DistributionSummary
  after: DistributionSummary
}

export type QcSheetSummary = {
  sheetName: string
  totalRows: number
  affectedRows: number
  keptRowRatio: number // 0..1; NaN-safe (0 rows -> 1)
}

export type QcTimelineBucket = {
  bucketStart: string // ISO
  bucketEnd: string // ISO
  count: number
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
  timeline: QcTimelineBucket[]
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
  }
}

function buildColumnStats(
  sheet: SheetData,
  cellState: Record<string, CellState>,
): QcColumnStat[] {
  return sheet.columns
    .map((columnName) => {
      const before = summarizeColumn(sheet.rows, sheet.name, columnName, {})
      const after = summarizeColumn(sheet.rows, sheet.name, columnName, cellState)
      // Skip columns with no numeric values at all (e.g. pure text/identifier columns) --
      // a before/after row of all dashes is noise, not information.
      if (before.count === 0 && after.count === 0) {
        return null
      }
      return { sheetName: sheet.name, columnName, before, after }
    })
    .filter((entry): entry is QcColumnStat => entry !== null)
}

function buildTimeline(auditLog: AuditAction[], bucketCount = 12): QcTimelineBucket[] {
  const qcEvents = auditLog.filter(
    (action) => CLEANING_ACTION_TYPES.includes(action.actionType) || action.actionType === 'undo',
  )
  if (qcEvents.length === 0) {
    return []
  }

  const timestamps = qcEvents.map((action) => new Date(action.timestamp).getTime())
  const start = Math.min(...timestamps)
  const end = Math.max(...timestamps)

  if (start === end) {
    return [{ bucketStart: new Date(start).toISOString(), bucketEnd: new Date(end).toISOString(), count: qcEvents.length }]
  }

  const span = end - start
  const bucketSize = span / bucketCount
  const buckets: QcTimelineBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    bucketStart: new Date(start + index * bucketSize).toISOString(),
    bucketEnd: new Date(start + (index + 1) * bucketSize).toISOString(),
    count: 0,
  }))

  qcEvents.forEach((action) => {
    const t = new Date(action.timestamp).getTime()
    const index = Math.min(bucketCount - 1, Math.floor((t - start) / bucketSize))
    buckets[index].count += 1
  })

  return buckets
}

export function buildQcReport(
  workbook: WorkbookData,
  cellState: Record<string, CellState>,
  auditLog: AuditAction[],
): QcReport {
  let breakdown: QcActionBreakdown = { flagged: 0, problem: 0, accepted: 0, custom: 0, blanked: 0, replaced: 0 }
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
    columnStats.push(...buildColumnStats(sheet, cellState))
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
    timeline: buildTimeline(auditLog),
  }
}
