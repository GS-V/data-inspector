export type RawCellValue = string | number | boolean | Date | null | undefined

export type RowData = Record<string, RawCellValue>

export type SheetData = {
  name: string
  columns: string[]
  rows: RowData[]
  identifierColumns: string[]
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
  | 'transform_log'
  | 'transform_log10'
  | 'transform_sqrt'
  | 'transform_boxcox'
  | 'transform_zscore'
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
  rowIdentifier: string
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

export type PlotType =
  | 'scatter'
  | 'histogram'
  | 'box'
  | 'qq'
  | 'density'
  | 'cdf'
  | 'violin'

export const PLOT_TYPE_OPTIONS: { value: PlotType; label: string }[] = [
  { value: 'scatter', label: 'Scatter' },
  { value: 'histogram', label: 'Histogram' },
  { value: 'box', label: 'Box plot' },
  { value: 'violin', label: 'Violin plot' },
  { value: 'qq', label: 'Q-Q plot' },
  { value: 'density', label: 'Density plot (KDE)' },
  { value: 'cdf', label: 'Cumulative distribution' },
]

export type TransformationType = 'log' | 'log10' | 'sqrt' | 'boxcox' | 'zscore'

export type TransformAttempt = {
  id: string
  type: TransformationType
  columns: string[]
  appliedAt: string
  lambda?: number
  statsBefore: DistributionSummary
  statsAfter: DistributionSummary
  skewnessBefore: number | null
  skewnessAfter: number | null
  sparkBefore: number[]
  sparkAfter: number[]
}

export const ROW_ORDER_AXIS = '__row_order__'
