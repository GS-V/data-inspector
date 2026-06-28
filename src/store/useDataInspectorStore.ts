import { create } from 'zustand'
import type {
  AuditAction,
  AuditActionType,
  CellId,
  CellMark,
  CellState,
  PlotType,
  PreviewCell,
  RawCellValue,
  SheetData,
  WorkbookData,
} from '../types/data'
import { ROW_ORDER_AXIS } from '../types/data'
import { makeCellId, parseCellId } from '../utils/cellId'
import { findNumericColumns, getEffectiveValue } from '../utils/numeric'

type CellChange = {
  cellId: CellId
  nextState?: CellState
  actionType: AuditActionType
  method: string
  reason: string
  reasonCategory?: string
  reasonNote?: string
  methodContext?: string
}

export type AuditReasonInput = {
  reasonCategory?: string
  reasonNote?: string
  methodContext?: string
}

type DataInspectorState = {
  workbook?: WorkbookData
  activeSheetName: string
  selectedColumn: string
  xAxis: string
  plotType: PlotType
  selectedCells: Record<CellId, true>
  previewCells: Record<CellId, PreviewCell>
  cellState: Record<CellId, CellState>
  auditLog: AuditAction[]
  undoStack: AuditAction[][]
  setWorkbook: (workbook: WorkbookData) => void
  setActiveSheetName: (sheetName: string) => void
  setSelectedColumn: (columnName: string) => void
  setXAxis: (xAxis: string) => void
  setPlotType: (plotType: PlotType) => void
  toggleSelectedCell: (cellId: CellId) => void
  addSelectedCells: (cellIds: CellId[]) => void
  clearSelection: () => void
  setPreviewCells: (previewCells: PreviewCell[]) => void
  clearPreview: () => void
  markTargets: (mark: Exclude<CellMark, 'blanked'>, highlightColor?: string) => void
  clearTargetMarks: () => void
  replaceSelectedTargets: (value: string | number, reasonInput?: AuditReasonInput) => void
  blankSelectedTargets: (reasonInput?: AuditReasonInput) => void
  blankMarkedInCurrentColumn: (mark: 'problem' | 'review', reasonInput?: AuditReasonInput) => void
  undoLastActionGroup: () => void
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

  return findNumericColumns(sheet.rows, sheet.columns)[0] ?? sheet.columns[0] ?? ''
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
    selectedCells: {},
    previewCells: {},
    cellState: {},
    auditLog: [],
    undoStack: [],

    setWorkbook: (workbook) => {
      const firstSheet = workbook.sheets[0]
      const selectedColumn = getFirstNumericColumn(firstSheet)
      set({
        workbook,
        activeSheetName: firstSheet?.name ?? '',
        selectedColumn,
        xAxis: ROW_ORDER_AXIS,
        plotType: 'scatter',
        selectedCells: {},
        previewCells: {},
        cellState: {},
        auditLog: [],
        undoStack: [],
      })
    },

    setActiveSheetName: (sheetName) => {
      const sheet = getSheet(get().workbook, sheetName)
      const currentColumn = get().selectedColumn
      const numericColumns = findNumericColumns(sheet?.rows ?? [], sheet?.columns ?? [])
      const selectedColumn =
        currentColumn && numericColumns.includes(currentColumn)
          ? currentColumn
          : getFirstNumericColumn(sheet)
      const currentXAxis = get().xAxis
      const xAxis =
        currentXAxis === ROW_ORDER_AXIS || numericColumns.includes(currentXAxis)
          ? currentXAxis
          : ROW_ORDER_AXIS

      set({
        activeSheetName: sheetName,
        selectedColumn,
        xAxis,
        selectedCells: {},
        previewCells: {},
      })
    },

    setSelectedColumn: (columnName) => {
      set({ selectedColumn: columnName, selectedCells: {}, previewCells: {} })
    },

    setXAxis: (xAxis) => set({ xAxis }),

    setPlotType: (plotType) => set({ plotType }),

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
          })
        })

      set({
        cellState: nextCellState,
        auditLog: [...state.auditLog, ...undoActions],
        undoStack: state.undoStack.slice(0, -1),
      })
    },
  }
})
