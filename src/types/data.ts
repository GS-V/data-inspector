export type RawCellValue = string | number | boolean | Date | null | undefined

export type RowData = Record<string, RawCellValue>

/** One tab of a workbook, with its rows, column names, and identifier columns. */
export type SheetData = {
  name: string
  columns: string[]
  rows: RowData[]
  identifierColumns: string[]
}

/** The parsed file. Rows and columns are immutable after load. */
export type WorkbookData = {
  fileName: string
  sheets: SheetData[]
  parseWarnings?: string[]
}

export type CellId = string

export type CellMark = 'review' | 'problem' | 'keep' | 'custom' | 'blanked' | 'imputed'

/** The edit overlay for one cell. Never stored in the raw row data. */
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
  | 'impute_mean'
  | 'impute_median'
  | 'impute_interpolate'
  | 'undo'

/** One recorded change, grouped with related changes by groupId. */
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
  /** Log base used, when actionType is transform_log10 with a non-default base. */
  base?: number
}

/** One cell a review tool suggests for inspection. Discarded on sheet or column change. */
export type PreviewCell = {
  cellId: CellId
  sheetName: string
  rowIndex: number
  columnName: string
  value: RawCellValue
  method: string
  reason: string
}

/** Descriptive statistics for one numeric column. A null field means the value is not computable. */
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
  | 'table'
  | 'scatter'
  | 'histogram'
  | 'box'
  | 'qq'
  | 'density'
  | 'cdf'
  | 'violin'

export const PLOT_TYPE_OPTIONS: { value: PlotType; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'histogram', label: 'Histogram' },
  { value: 'box', label: 'Box plot' },
  { value: 'violin', label: 'Violin plot' },
  { value: 'qq', label: 'Q-Q plot' },
  { value: 'density', label: 'Density plot (KDE)' },
  { value: 'cdf', label: 'Cumulative distribution' },
]

export type TransformationType = 'log' | 'log10' | 'sqrt' | 'boxcox' | 'zscore'

export type NormalityTestType = 'shapiro-wilk' | 'jarque-bera' | 'anderson-darling'

export const NORMALITY_TEST_OPTIONS: { value: NormalityTestType; label: string }[] = [
  { value: 'shapiro-wilk', label: 'Shapiro-Wilk' },
  { value: 'jarque-bera', label: 'Jarque-Bera' },
  { value: 'anderson-darling', label: 'Anderson-Darling' },
]

/** The output of a normality test run against a numeric array. */
export type NormalityTestResult = {
  testName: NormalityTestType
  statistic: number | null
  pValue: number | null
  n: number
  warnings: string[]
}

/** One applied column transform with before/after statistics. */
export type TransformAttempt = {
  id: string
  type: TransformationType
  sheetName: string
  columns: string[]
  appliedAt: string
  lambda?: number
  useOffset?: boolean
  /** Log base used when type is 'log10'. Absent on older history entries, which mean base 10. */
  base?: number
  statsBefore: DistributionSummary
  statsAfter: DistributionSummary
  skewnessBefore: number | null
  skewnessAfter: number | null
  sparkBefore: number[]
  sparkAfter: number[]
  normalityTestType: NormalityTestType
  normalityThreshold: number
  normalityBefore: NormalityTestResult | null
  normalityAfter: NormalityTestResult | null
}

export type ImputationMethod = 'mean' | 'median' | 'interpolate'

export const IMPUTATION_METHOD_OPTIONS: { value: ImputationMethod; label: string }[] = [
  { value: 'mean', label: 'Fill with column mean' },
  { value: 'median', label: 'Fill with column median' },
  { value: 'interpolate', label: 'Linear interpolation' },
]

export const ROW_ORDER_AXIS = '__row_order__'

/** A serialisable snapshot of the full workspace state for save and restore. */
export type SessionFile = {
  version: 1
  savedAt: string
  sourceFileName: string
  activeSheetName: string
  selectedColumn: string
  xAxis: string
  plotType: PlotType
  comparisonColumns: string[]
  requireReason: boolean
  normalityTestType: NormalityTestType
  normalityThreshold: number
  cellState: Record<string, CellState>
  auditLog: AuditAction[]
  undoStack: AuditAction[][]
  transformHistory: TransformAttempt[]
}
