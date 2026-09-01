import { create } from 'zustand'
import type {
  AuditAction,
  AuditActionType,
  CellId,
  CellMark,
  CellState,
  ImputationMethod,
  NormalityTestResult,
  NormalityTestType,
  PlotType,
  PreviewCell,
  RawCellValue,
  SessionFile,
  SheetData,
  TransformationType,
  TransformAttempt,
  WorkbookData,
} from '../types/data'
import { ROW_ORDER_AXIS } from '../types/data'
import { getVisibleColumnValues } from '../utils/chartData'
import { makeCellId, parseCellId } from '../utils/cellId'
import { buildRowIdentifier, findValueColumns, getEffectiveValue, isDateCol, isMissing } from '../utils/numeric'
import { formatNumber, summarizeNumbers } from '../utils/stats'
import { calculateSkewness, computeSparkbucket, runNormalityTest, transformValue } from '../utils/transforms'
import { exportSession } from '../utils/sessionIO'

type CellChange = {
  cellId: CellId
  nextState?: CellState
  actionType: AuditActionType
  method: string
  reason: string
  reasonCategory?: string
  reasonNote?: string
  methodContext?: string
  base?: number
}

export type AuditReasonInput = {
  reasonCategory?: string
  reasonNote?: string
  methodContext?: string
}

type DataInspectorState = {
  // The parsed file itself -- immutable raw rows/columns. Set once by setWorkbook() on file load;
  // every downstream action reads it but never edits it directly (edits live in cellState instead).
  workbook?: WorkbookData
  // Which sheet, value column, X-axis column, and chart type the chart panel currently renders.
  activeSheetName: string
  selectedColumn: string
  xAxis: string
  plotType: PlotType
  // Additional numeric columns overlaid on the chart alongside selectedColumn -- visualization-only.
  // Cleaning tools, the stats panel, and transforms always operate on selectedColumn regardless of
  // this list. Cleared whenever selectedColumn, the active sheet, or the workbook changes.
  comparisonColumns: string[]
  // Transient, UI-only cell targeting: selectedCells is the user's manual click/drag selection,
  // previewCells is whatever a review tool (outlier/duplicate/threshold preview) last suggested.
  // Neither is persisted -- they're cleared on column/sheet change and never written to the audit log.
  selectedCells: Record<CellId, true>
  // True while a large multi-point/multi-row selection (drag-select, shift-click range) is being
  // committed -- set by the caller around a deferred addSelectedCells call so the "Selected" status
  // chip can show a brief busy state instead of the UI silently hanging on large selections. Not
  // used for single-cell click/toggle, which is cheap enough not to need it.
  isSelecting: boolean
  previewCells: Record<CellId, PreviewCell>
  // The actual overlay of user edits, keyed by cell ID: marks, highlights, and value overrides.
  // This is the one mutable "cleaned" layer sitting on top of the immutable `workbook` rows.
  cellState: Record<CellId, CellState>
  // Full append-only history of every action taken (owned by applyCellChanges), plus the stack of
  // action-groups undoLastActionGroup() pops from, one group per user-facing action.
  auditLog: AuditAction[]
  undoStack: AuditAction[][]
  // One entry per applied column transform (log/sqrt/box-cox/z-score), feeding the Transform tab's
  // history panel, its before/after stats, and its Python/R "copy as code" snippets.
  transformHistory: TransformAttempt[]
  // User-selected settings for the Transform tab's "Check normality" button -- which test to run
  // and the significance threshold used to render its pass/fail verdict.
  normalityTestType: NormalityTestType
  normalityThreshold: number
  // Action panel "Require reason for changes" toggle. Off by default; survives sheet switches
  // (it's a session-wide preference, not per-sheet state) but is never persisted across reloads.
  requireReason: boolean
  setWorkbook: (workbook: WorkbookData) => void
  setActiveSheetName: (sheetName: string) => void
  setSelectedColumn: (columnName: string, options?: { preserveSelection?: boolean }) => void
  setXAxis: (xAxis: string) => void
  setPlotType: (plotType: PlotType) => void
  addComparisonColumn: (columnName: string) => void
  removeComparisonColumn: (columnName: string) => void
  clearComparisonColumns: () => void
  toggleSelectedCell: (cellId: CellId) => void
  addSelectedCells: (cellIds: CellId[]) => void
  clearSelection: () => void
  setIsSelecting: (isSelecting: boolean) => void
  setPreviewCells: (previewCells: PreviewCell[]) => void
  clearPreview: () => void
  markTargets: (mark: Exclude<CellMark, 'blanked'>, highlightColor?: string) => void
  clearTargetMarks: () => void
  replaceSelectedTargets: (value: string | number, reasonInput?: AuditReasonInput) => void
  blankSelectedTargets: (reasonInput?: AuditReasonInput) => void
  blankMarkedInCurrentColumn: (mark: 'problem' | 'review', reasonInput?: AuditReasonInput) => void
  applyColumnTransform: (
    columnNames: string[],
    type: TransformationType,
    params?: { useOffset?: boolean; lambda?: number; base?: number },
  ) => { appliedCount: number; skippedCount: number }
  imputeMissingValues: (
    method: ImputationMethod,
    reasonInput?: AuditReasonInput,
  ) => { appliedCount: number; skippedCount: number }
  setNormalityTestType: (type: NormalityTestType) => void
  setNormalityThreshold: (threshold: number) => void
  setRequireReason: (requireReason: boolean) => void
  checkColumnNormality: (columnNames: string[]) => NormalityTestResult | null
  undoLastActionGroup: () => void
  saveSession: () => void
  restoreSession: (session: SessionFile, options?: { force?: boolean }) => { warnings: string[] }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function cloneCellState(state?: CellState): CellState | undefined {
  if (!state) {
    return undefined
  }

  return { ...state }
}

function compactCellState(state?: CellState): CellState | undefined {
  if (!state) {
    return undefined
  }

  const hasOverride = Object.prototype.hasOwnProperty.call(state, 'valueOverride')
  const hasMark = Boolean(state.mark)
  const hasHighlightColor = Boolean(state.highlightColor)
  const hasNote = Boolean(state.note)

  if (!hasOverride && !hasMark && !hasHighlightColor && !hasNote) {
    return undefined
  }

  return { ...state }
}

function statesEqual(first?: CellState, second?: CellState): boolean {
  return JSON.stringify(first ?? {}) === JSON.stringify(second ?? {})
}

function getSheet(workbook: WorkbookData | undefined, sheetName: string): SheetData | undefined {
  return workbook?.sheets.find((sheet) => sheet.name === sheetName)
}

function getFirstNumericColumn(sheet?: SheetData): string {
  if (!sheet) {
    return ''
  }

  return findValueColumns(sheet.rows, sheet.columns)[0] ?? sheet.columns[0] ?? ''
}

function getRawValue(sheet: SheetData, rowIndex: number, columnName: string): RawCellValue {
  return sheet.rows[rowIndex]?.[columnName]
}

function markActionType(mark: Exclude<CellMark, 'blanked'>): AuditActionType {
  if (mark === 'review') {
    return 'mark_review'
  }

  if (mark === 'problem') {
    return 'mark_problem'
  }

  if (mark === 'keep') {
    return 'mark_keep'
  }

  return 'mark_custom'
}

function transformActionType(type: TransformationType): AuditActionType {
  if (type === 'log') return 'transform_log'
  if (type === 'log10') return 'transform_log10'
  if (type === 'sqrt') return 'transform_sqrt'
  if (type === 'boxcox') return 'transform_boxcox'
  return 'transform_zscore'
}

function transformMethod(type: TransformationType, base?: number): string {
  if (type === 'log') return 'log transform'
  if (type === 'log10') return `log${base ?? 10} transform`
  if (type === 'sqrt') return 'square root transform'
  if (type === 'boxcox') return 'box-cox transform'
  return 'z-score transform'
}

function transformReason(type: TransformationType, columnName: string, lambda?: number, base?: number): string {
  if (type === 'log') return `Applied natural log transformation to column ${columnName}`
  if (type === 'log10') return `Applied log${base ?? 10} transformation to column ${columnName}`
  if (type === 'sqrt') return `Applied square root transformation to column ${columnName}`
  if (type === 'boxcox') return `Applied Box-Cox transformation (λ=${(lambda ?? 1).toFixed(2)}) to column ${columnName}`
  return `Applied z-score transformation to column ${columnName}`
}

function imputeActionType(method: ImputationMethod): AuditActionType {
  if (method === 'mean') return 'impute_mean'
  if (method === 'median') return 'impute_median'
  return 'impute_interpolate'
}

function imputeMethodLabel(method: ImputationMethod): string {
  if (method === 'mean') return 'impute column mean'
  if (method === 'median') return 'impute column median'
  return 'impute linear interpolation'
}

function imputeReason(method: ImputationMethod, value: number): string {
  if (method === 'mean') return `Filled with column mean (${formatNumber(value)})`
  if (method === 'median') return `Filled with column median (${formatNumber(value)})`
  return `Filled with linear interpolation (${formatNumber(value)})`
}

function normalizeReasonInput(reasonInput?: AuditReasonInput): AuditReasonInput {
  return {
    reasonCategory: reasonInput?.reasonCategory?.trim() || undefined,
    reasonNote: reasonInput?.reasonNote?.trim() || undefined,
    methodContext: reasonInput?.methodContext?.trim() || undefined,
  }
}

function readableReason(baseReason: string, reasonInput?: AuditReasonInput): string {
  const normalized = normalizeReasonInput(reasonInput)
  const detail = [normalized.reasonCategory, normalized.reasonNote].filter(Boolean).join(' — ')
  return detail ? `${baseReason} — ${detail}` : baseReason
}

function withReasonContext<T extends Omit<CellChange, 'reasonCategory' | 'reasonNote' | 'methodContext'>>(
  change: T,
  reasonInput?: AuditReasonInput,
): T & AuditReasonInput {
  const normalized = normalizeReasonInput(reasonInput)
  return {
    ...change,
    ...normalized,
    reason: readableReason(change.reason, normalized),
  }
}

export const useDataInspectorStore = create<DataInspectorState>((set, get) => {
  function applyCellChanges(changes: CellChange[]) {
    const state = get()
    const groupId = makeId('group')
    const timestamp = new Date().toISOString()
    const nextCellState = { ...state.cellState }
    const actions: AuditAction[] = []

    changes.forEach((change) => {
      const { sheetName, rowIndex, columnName } = parseCellId(change.cellId)
      const sheet = getSheet(state.workbook, sheetName)
      if (!sheet || !sheet.columns.includes(columnName) || !sheet.rows[rowIndex]) {
        return
      }

      const oldCellState = cloneCellState(nextCellState[change.cellId])
      const newCellState = compactCellState(change.nextState)
      if (statesEqual(oldCellState, newCellState)) {
        return
      }

      const rawValue = getRawValue(sheet, rowIndex, columnName)
      const oldValue = getEffectiveValue(rawValue, oldCellState)
      const newValue = getEffectiveValue(rawValue, newCellState)

      if (newCellState) {
        nextCellState[change.cellId] = newCellState
      } else {
        delete nextCellState[change.cellId]
      }

      const rowIdentifier = buildRowIdentifier(
        sheet.rows[rowIndex],
        rowIndex,
        sheet.identifierColumns ?? [],
        oldValue,
      )

      actions.push({
        id: makeId('audit'),
        timestamp,
        groupId,
        actionType: change.actionType,
        sheetName,
        rowIndex,
        columnName,
        cellId: change.cellId,
        oldValue,
        newValue,
        oldCellState,
        newCellState,
        method: change.method,
        reason: change.reason,
        reasonCategory: change.reasonCategory,
        reasonNote: change.reasonNote,
        methodContext: change.methodContext,
        rowIdentifier,
        base: change.base,
      })
    })

    if (actions.length === 0) {
      return
    }

    set({
      cellState: nextCellState,
      auditLog: [...state.auditLog, ...actions],
      undoStack: [...state.undoStack, actions],
    })
  }

  function getTargetCellIds(): CellId[] {
    return Array.from(
      new Set([...Object.keys(get().selectedCells), ...Object.keys(get().previewCells)]),
    )
  }

  function previewMethodContext(cellIds: CellId[]): string | undefined {
    const { previewCells } = get()
    const methods = Array.from(
      new Set(cellIds.map((cellId) => previewCells[cellId]?.method).filter(Boolean)),
    )

    return methods.length > 0 ? `Acted after preview: ${methods.join(', ')}` : undefined
  }

  return {
    workbook: undefined,
    activeSheetName: '',
    selectedColumn: '',
    xAxis: ROW_ORDER_AXIS,
    plotType: 'scatter',
    comparisonColumns: [],
    selectedCells: {},
    isSelecting: false,
    previewCells: {},
    cellState: {},
    auditLog: [],
    undoStack: [],
    transformHistory: [],
    normalityTestType: 'shapiro-wilk',
    normalityThreshold: 0.05,
    requireReason: false,

    setWorkbook: (workbook) => {
      const firstSheet = workbook.sheets[0]
      const selectedColumn = getFirstNumericColumn(firstSheet)
      set({
        workbook,
        activeSheetName: firstSheet?.name ?? '',
        selectedColumn,
        xAxis: ROW_ORDER_AXIS,
        plotType: 'scatter',
        comparisonColumns: [],
        selectedCells: {},
        previewCells: {},
        cellState: {},
        auditLog: [],
        undoStack: [],
        transformHistory: [],
      })
    },

    setActiveSheetName: (sheetName) => {
      const sheet = getSheet(get().workbook, sheetName)
      const currentColumn = get().selectedColumn
      const valueColumns = findValueColumns(sheet?.rows ?? [], sheet?.columns ?? [])
      const selectedColumn =
        currentColumn && valueColumns.includes(currentColumn)
          ? currentColumn
          : getFirstNumericColumn(sheet)
      // X-axis accepts any column (date, numeric, or string/categorical), so its validity check
      // is against the sheet's full column list, not just the numeric-value ones.
      const currentXAxis = get().xAxis
      const xAxis =
        currentXAxis === ROW_ORDER_AXIS || (sheet?.columns ?? []).includes(currentXAxis)
          ? currentXAxis
          : ROW_ORDER_AXIS

      set({
        activeSheetName: sheetName,
        selectedColumn,
        xAxis,
        comparisonColumns: [],
        selectedCells: {},
        previewCells: {},
      })
    },

    setSelectedColumn: (columnName, options) => {
      if (options?.preserveSelection) {
        // Used only by TableView's ctrl/cmd-click, which needs to move the active column to
        // whatever cell was just clicked without wiping cells already selected in other columns.
        set({ selectedColumn: columnName, comparisonColumns: [] })
      } else {
        set({ selectedColumn: columnName, selectedCells: {}, previewCells: {}, comparisonColumns: [] })
      }
    },

    setXAxis: (xAxis) => {
      // A column can't be both the X-axis and a comparison overlay (it would plot as a trivial
      // diagonal against itself) -- drop it from comparisonColumns if it's already checked there.
      const { comparisonColumns } = get()
      set({ xAxis, comparisonColumns: comparisonColumns.filter((column) => column !== xAxis) })
    },

    // Every chart type either supports the comparison overlay (scatter, histogram, box, violin,
    // density, cdf, qq) or simply ignores it (table), so switching plot types never needs to
    // clear comparisonColumns.
    setPlotType: (plotType) => set({ plotType }),

    addComparisonColumn: (columnName) => {
      const { comparisonColumns, selectedColumn, xAxis, workbook, activeSheetName } = get()
      const sheet = getSheet(workbook, activeSheetName)
      if (
        columnName === selectedColumn ||
        columnName === xAxis ||
        comparisonColumns.includes(columnName) ||
        comparisonColumns.length >= 4 ||
        (sheet && isDateCol(columnName, sheet.rows))
      ) {
        return
      }
      set({ comparisonColumns: [...comparisonColumns, columnName] })
    },

    removeComparisonColumn: (columnName) => {
      set({ comparisonColumns: get().comparisonColumns.filter((column) => column !== columnName) })
    },

    clearComparisonColumns: () => set({ comparisonColumns: [] }),

    toggleSelectedCell: (cellId) => {
      const selectedCells = { ...get().selectedCells }
      if (selectedCells[cellId]) {
        delete selectedCells[cellId]
      } else {
        selectedCells[cellId] = true
      }
      set({ selectedCells })
    },

    addSelectedCells: (cellIds) => {
      const selectedCells = { ...get().selectedCells }
      cellIds.forEach((cellId) => {
        selectedCells[cellId] = true
      })
      set({ selectedCells })
    },

    clearSelection: () => set({ selectedCells: {} }),

    setIsSelecting: (isSelecting) => set({ isSelecting }),

    setPreviewCells: (previewCells) => {
      set({
        previewCells: Object.fromEntries(previewCells.map((cell) => [cell.cellId, cell])),
      })
    },

    clearPreview: () => set({ previewCells: {} }),

    markTargets: (mark, highlightColor) => {
      const { cellState } = get()
      const targetCellIds = getTargetCellIds()
      const methodContext = previewMethodContext(targetCellIds)
      const changes = targetCellIds.map((cellId) => {
        const nextState = { ...(cellState[cellId] ?? {}), mark }
        if (mark === 'custom') {
          nextState.highlightColor = highlightColor ?? '#a855f7'
        } else {
          delete nextState.highlightColor
        }

        return {
          cellId,
          nextState,
          actionType: markActionType(mark),
          method: 'manual mark',
          reason: mark === 'custom' ? `Custom highlight ${nextState.highlightColor}` : `Marked ${mark}`,
          methodContext,
        }
      })

      applyCellChanges(changes)
    },

    clearTargetMarks: () => {
      const { cellState } = get()
      const targetCellIds = getTargetCellIds()
      const methodContext = previewMethodContext(targetCellIds)
      const changes = targetCellIds
        .filter((cellId) => Boolean(cellState[cellId]?.mark))
        .map((cellId) => {
          const nextState = { ...(cellState[cellId] ?? {}) }
          delete nextState.mark
          delete nextState.highlightColor
          return {
            cellId,
            nextState,
            actionType: 'clear_mark' as const,
            method: 'manual clear',
            reason: 'Cleared mark',
            methodContext,
          }
        })

      applyCellChanges(changes)
    },

    replaceSelectedTargets: (value, reasonInput) => {
      const { cellState, selectedCells } = get()
      const changes = Object.keys(selectedCells).map((cellId) => {
        const nextState = {
          ...(cellState[cellId] ?? {}),
          valueOverride: value,
        }

        if (nextState.mark === 'blanked') {
          delete nextState.mark
        }

        return withReasonContext({
          cellId,
          nextState,
          actionType: 'replace_value' as const,
          method: 'manual replacement',
          reason: `Replaced selected value with ${String(value)}`,
        }, reasonInput)
      })

      applyCellChanges(changes)
    },

    blankSelectedTargets: (reasonInput) => {
      const { cellState } = get()
      const changes = getTargetCellIds().map((cellId) => {
        const nextState = {
          ...(cellState[cellId] ?? {}),
          valueOverride: null,
          mark: 'blanked' as const,
        }
        delete nextState.highlightColor

        return withReasonContext({
          cellId,
          nextState,
          actionType: 'blank_selected' as const,
          method: 'manual blank',
          reason: 'Blanked selected or previewed cell',
        }, reasonInput)
      })

      applyCellChanges(changes)
    },

    blankMarkedInCurrentColumn: (mark, reasonInput) => {
      const state = get()
      const sheet = getSheet(state.workbook, state.activeSheetName)
      if (!sheet || !state.selectedColumn) {
        return
      }

      const changes = sheet.rows
        .map((_, rowIndex) => makeCellId(sheet.name, rowIndex, state.selectedColumn))
        .filter((cellId) => state.cellState[cellId]?.mark === mark)
        .map((cellId) => {
          const nextState = {
            ...(state.cellState[cellId] ?? {}),
            valueOverride: null,
            mark: 'blanked' as const,
          }
          delete nextState.highlightColor

          return withReasonContext({
            cellId,
            nextState,
            actionType: mark === 'problem' ? ('blank_problem' as const) : ('blank_review' as const),
            method: `blank all ${mark}`,
            reason: `Blanked all ${mark} cells in current sheet and column`,
          }, reasonInput)
        })

      applyCellChanges(changes)
    },

    applyColumnTransform: (columnNames, type, params) => {
      const state = get()
      const sheet = getSheet(state.workbook, state.activeSheetName)
      if (!sheet || columnNames.length === 0) {
        return { appliedCount: 0, skippedCount: 0 }
      }

      const beforeValues = columnNames.flatMap(
        (columnName) => getVisibleColumnValues(sheet, columnName, state.cellState).map((entry) => entry.value),
      )

      const lambda = params?.lambda ?? 1
      const base = type === 'log10' ? (params?.base ?? 10) : undefined
      const changes: CellChange[] = []
      let appliedCount = 0
      let skippedCount = 0

      columnNames.forEach((columnName) => {
        const entries = getVisibleColumnValues(sheet, columnName, state.cellState)
        const columnValues = entries.map((entry) => entry.value)
        const mean =
          columnValues.length > 0 ? columnValues.reduce((sum, value) => sum + value, 0) / columnValues.length : undefined
        const sd =
          mean !== undefined && columnValues.length > 1
            ? Math.sqrt(columnValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (columnValues.length - 1))
            : undefined

        entries.forEach((entry) => {
          const transformed = transformValue(entry.value, type, {
            useOffset: params?.useOffset,
            lambda,
            mean,
            sd,
            base,
          })

          if (transformed === null || !Number.isFinite(transformed)) {
            skippedCount += 1
            return
          }

          const nextState = {
            ...(state.cellState[entry.cellId] ?? {}),
            valueOverride: transformed,
          }
          if (nextState.mark === 'blanked') {
            delete nextState.mark
          }

          changes.push({
            cellId: entry.cellId,
            nextState,
            actionType: transformActionType(type),
            method: transformMethod(type, base),
            reason: transformReason(type, columnName, lambda, base),
            base,
          })
          appliedCount += 1
        })
      })

      applyCellChanges(changes)

      const afterState = get()
      const afterValues = columnNames.flatMap(
        (columnName) => getVisibleColumnValues(sheet, columnName, afterState.cellState).map((entry) => entry.value),
      )

      const normalityTestType = get().normalityTestType
      const normalityThreshold = get().normalityThreshold
      const normalityBefore = beforeValues.length > 0 ? runNormalityTest(beforeValues, normalityTestType) : null
      const normalityAfter = afterValues.length > 0 ? runNormalityTest(afterValues, normalityTestType) : null

      const attempt: TransformAttempt = {
        id: makeId('transform'),
        type,
        sheetName: sheet.name,
        columns: columnNames,
        appliedAt: new Date().toISOString(),
        lambda: type === 'boxcox' ? lambda : undefined,
        useOffset: params?.useOffset,
        base,
        statsBefore: summarizeNumbers(beforeValues, 0),
        statsAfter: summarizeNumbers(afterValues, 0),
        skewnessBefore: calculateSkewness(beforeValues),
        skewnessAfter: calculateSkewness(afterValues),
        sparkBefore: computeSparkbucket(beforeValues),
        sparkAfter: computeSparkbucket(afterValues),
        normalityTestType,
        normalityThreshold,
        normalityBefore,
        normalityAfter,
      }

      set({ transformHistory: [...afterState.transformHistory, attempt] })

      return { appliedCount, skippedCount }
    },

    imputeMissingValues: (method, reasonInput) => {
      const state = get()
      const sheet = getSheet(state.workbook, state.activeSheetName)
      const columnName = state.selectedColumn
      if (!sheet || !columnName) {
        return { appliedCount: 0, skippedCount: 0 }
      }

      const selectedTargetIds = getTargetCellIds().filter((cellId) => {
        const parsed = parseCellId(cellId)
        return parsed.sheetName === sheet.name && parsed.columnName === columnName
      })

      const candidateRowIndexes =
        selectedTargetIds.length > 0
          ? selectedTargetIds.map((cellId) => parseCellId(cellId).rowIndex).sort((a, b) => a - b)
          : sheet.rows.map((_, rowIndex) => rowIndex)

      const missingRowIndexes = candidateRowIndexes.filter((rowIndex) => {
        const cellId = makeCellId(sheet.name, rowIndex, columnName)
        return isMissing(getEffectiveValue(getRawValue(sheet, rowIndex, columnName), state.cellState[cellId]))
      })

      if (missingRowIndexes.length === 0) {
        return { appliedCount: 0, skippedCount: 0 }
      }

      // Neighbor/mean/median values are all computed once up front from this snapshot, then
      // applied to every target cell -- mirrors applyColumnTransform's beforeValues/mean/sd
      // pattern so a batch of fills within one action never chains off each other's new values.
      const visibleEntries = getVisibleColumnValues(sheet, columnName, state.cellState)
      if (visibleEntries.length === 0) {
        return { appliedCount: 0, skippedCount: missingRowIndexes.length }
      }

      const changes: CellChange[] = []
      let appliedCount = 0
      let skippedCount = 0

      const pushFill = (rowIndex: number, fillValue: number) => {
        const cellId = makeCellId(sheet.name, rowIndex, columnName)
        const nextState = {
          ...(state.cellState[cellId] ?? {}),
          valueOverride: fillValue,
          mark: 'imputed' as const,
        }
        delete nextState.highlightColor

        changes.push(withReasonContext({
          cellId,
          nextState,
          actionType: imputeActionType(method),
          method: imputeMethodLabel(method),
          reason: imputeReason(method, fillValue),
        }, reasonInput))
        appliedCount += 1
      }

      if (method === 'interpolate') {
        missingRowIndexes.forEach((rowIndex) => {
          let low = 0
          let high = visibleEntries.length
          while (low < high) {
            const mid = (low + high) >> 1
            if (visibleEntries[mid].rowIndex < rowIndex) {
              low = mid + 1
            } else {
              high = mid
            }
          }
          const next = visibleEntries[low]
          const prev = visibleEntries[low - 1]

          if (!prev || !next) {
            skippedCount += 1
            return
          }

          const fillValue =
            prev.value + ((next.value - prev.value) * (rowIndex - prev.rowIndex)) / (next.rowIndex - prev.rowIndex)
          pushFill(rowIndex, fillValue)
        })
      } else {
        const summary = summarizeNumbers(visibleEntries.map((entry) => entry.value), 0)
        const fillValue = method === 'mean' ? summary.mean : summary.median
        if (fillValue === null) {
          return { appliedCount: 0, skippedCount: missingRowIndexes.length }
        }

        missingRowIndexes.forEach((rowIndex) => pushFill(rowIndex, fillValue))
      }

      applyCellChanges(changes)

      return { appliedCount, skippedCount }
    },

    setRequireReason: (requireReason) => set({ requireReason }),

    setNormalityTestType: (type) => set({ normalityTestType: type }),

    setNormalityThreshold: (threshold) => {
      const clamped =
        Number.isFinite(threshold) && threshold > 0 && threshold < 1
          ? threshold
          : Math.min(0.5, Math.max(0.001, Number.isFinite(threshold) ? threshold : 0.05))
      set({ normalityThreshold: clamped })
    },

    checkColumnNormality: (columnNames) => {
      const state = get()
      const sheet = getSheet(state.workbook, state.activeSheetName)
      if (!sheet || columnNames.length === 0) {
        return null
      }
      const values = columnNames.flatMap(
        (columnName) => getVisibleColumnValues(sheet, columnName, state.cellState).map((entry) => entry.value),
      )
      if (values.length === 0) {
        return null
      }
      return runNormalityTest(values, state.normalityTestType)
    },

    undoLastActionGroup: () => {
      const state = get()
      const lastGroup = state.undoStack.at(-1)
      if (!lastGroup) {
        return
      }

      const nextCellState = { ...state.cellState }
      const groupId = makeId('undo-group')
      const timestamp = new Date().toISOString()
      const undoActions: AuditAction[] = []

      lastGroup
        .slice()
        .reverse()
        .forEach((action) => {
          const sheet = getSheet(state.workbook, action.sheetName)
          if (!sheet) {
            return
          }

          const currentCellState = cloneCellState(nextCellState[action.cellId])
          const restoredCellState = cloneCellState(action.oldCellState)
          const rawValue = getRawValue(sheet, action.rowIndex, action.columnName)

          if (restoredCellState) {
            nextCellState[action.cellId] = restoredCellState
          } else {
            delete nextCellState[action.cellId]
          }

          undoActions.push({
            id: makeId('audit'),
            timestamp,
            groupId,
            actionType: 'undo',
            sheetName: action.sheetName,
            rowIndex: action.rowIndex,
            columnName: action.columnName,
            cellId: action.cellId,
            oldValue: getEffectiveValue(rawValue, currentCellState),
            newValue: getEffectiveValue(rawValue, restoredCellState),
            oldCellState: currentCellState,
            newCellState: restoredCellState,
            method: 'undo',
            reason: `Reverted ${action.actionType}`,
            reasonCategory: action.reasonCategory,
            reasonNote: action.reasonNote,
            methodContext: action.methodContext
              ? `Undo of ${action.methodContext}`
              : `Undo of ${action.method}`,
            rowIdentifier: action.rowIdentifier,
          })
        })

      set({
        cellState: nextCellState,
        auditLog: [...state.auditLog, ...undoActions],
        undoStack: state.undoStack.slice(0, -1),
      })
    },

    saveSession: () => {
      const state = get()
      if (!state.workbook) return
      const session: SessionFile = {
        version: 1,
        savedAt: new Date().toISOString(),
        sourceFileName: state.workbook.fileName,
        activeSheetName: state.activeSheetName,
        selectedColumn: state.selectedColumn,
        xAxis: state.xAxis,
        plotType: state.plotType,
        comparisonColumns: state.comparisonColumns,
        requireReason: state.requireReason,
        normalityTestType: state.normalityTestType,
        normalityThreshold: state.normalityThreshold,
        cellState: state.cellState,
        auditLog: state.auditLog,
        undoStack: state.undoStack,
        transformHistory: state.transformHistory,
      }
      exportSession(session)
    },

    restoreSession: (session, options) => {
      const state = get()
      if (!state.workbook) return { warnings: [] }

      if (!options?.force && session.sourceFileName !== state.workbook.fileName) {
        return {
          warnings: [
            `Session was saved for "${session.sourceFileName}". ` +
            `Current file is "${state.workbook.fileName}". Restore anyway?`
          ]
        }
      }

      set({
        activeSheetName: session.activeSheetName,
        selectedColumn: session.selectedColumn,
        xAxis: session.xAxis,
        plotType: session.plotType,
        comparisonColumns: session.comparisonColumns,
        requireReason: session.requireReason,
        normalityTestType: session.normalityTestType,
        normalityThreshold: session.normalityThreshold,
        cellState: session.cellState,
        auditLog: session.auditLog,
        undoStack: session.undoStack,
        transformHistory: session.transformHistory,
        selectedCells: {},
        previewCells: {},
        isSelecting: false,
      })

      return { warnings: [] }
    },
  }
})
