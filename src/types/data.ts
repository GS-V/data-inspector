export type RawCellValue = string | number | boolean | Date | null | undefined

export type RowData = Record<string, RawCellValue>

export type SheetData = {
  name: string
  columns: string[]
  rows: RowData[]
}

export type WorkbookData = {
  fileName: string
  sheets: SheetData[]
  parseWarnings?: string[]
}

export type CellId = string

export type CellMark = 'review' | 'problem' | 'keep' | 'custom' | 'blanked'

export type CellState = {
  mark?: CellMark
  highlightColor?: string
  valueOverride?: string | number | null
  note?: string
}

export type AuditActionType =
  | 'mark_review'
  | 'mark_problem'
  | 'mark_keep'
  | 'mark_custom'
  | 'clear_mark'
  | 'blank_selected'
  | 'blank_problem'
  | 'blank_review'
  | 'replace_value'
  | 'undo'

export type AuditAction = {
  id: string
  timestamp: string
  groupId: string
  actionType: AuditActionType
  sheetName: string
  rowIndex: number
  columnName: string
  cellId: CellId
  oldValue: RawCellValue
  newValue: RawCellValue
  oldCellState?: CellState
  newCellState?: CellState
  method: string
  reason: string
  reasonCategory?: string
  reasonNote?: string
  methodContext?: string
}

export type PreviewCell = {
  cellId: CellId
  sheetName: string
  rowIndex: number
  columnName: string
  value: RawCellValue
  method: string
  reason: string
}

export type DistributionSummary = {
  count: number
  missingCount: number
  mean: number | null
  median: number | null
  min: number | null
  q1: number | null
  q3: number | null
  max: number | null
  iqr: number | null
  standardDeviation: number | null
}

export type PlotType = 'scatter' | 'histogram'

export type SelectionMode = 'click' | 'box' | 'lasso'

export const ROW_ORDER_AXIS = '__row_order__'
