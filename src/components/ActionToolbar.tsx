import { useEffect, useMemo, useState } from 'react'
import { AuditLogPanel } from './AuditLogPanel'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { InfoTip } from './InfoTip'
import { ModalPortal } from './ModalPortal'
import { QcReportModal } from './QcReportModal'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { AuditReasonInput } from '../store/useDataInspectorStore'
import type { CellMark, ImputationMethod } from '../types/data'
import { IMPUTATION_METHOD_OPTIONS } from '../types/data'
import { hasCompleteAuditReason } from '../utils/auditReason'
import { makeCellId, parseCellId } from '../utils/cellId'
import { getVisibleColumnValues } from '../utils/chartData'
import { buildAuditLogCsv, buildCleanedCsv, downloadCsv, downloadHighlightedXlsxWorkbook } from '../utils/exportCsv'
import { findNumericColumns, getEffectiveValue, isMissing } from '../utils/numeric'

type ExportType = 'csv' | 'xlsx'
type ExportStatus = 'idle' | 'preparing' | 'applying' | 'creating' | 'ready' | 'failed'
type PendingCleaningAction =
  | { kind: 'replace'; value: string | number; count: number }
  | { kind: 'blankSelected'; count: number }
  | { kind: 'blankProblem'; count: number }
  | { kind: 'blankReview'; count: number }
  | { kind: 'impute'; method: ImputationMethod; count: number }

const reasonCategories = [
  'Measurement error',
  'Data entry issue',
  'Sensor/image artifact',
  'Out of expected range',
  'Duplicate value',
  'Other',
]

function fileStem(fileName: string | undefined): string {
  return (fileName ?? 'data-inspector').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-')
}

const CHIP_ICONS: Partial<Record<string, IconName>> = {
  review: 'flag',
  problem: 'alert',
  keep: 'check-circle',
  custom: 'palette',
  blanked: 'eraser',
  imputed: 'fill',
}

function CountChip({
  label,
  value,
  tone,
  busy,
}: {
  label: string
  value: number
  tone?: string
  busy?: boolean
}) {
  const iconName = tone ? CHIP_ICONS[tone] : undefined

  return (
    <span className={`count-chip ${tone ?? ''}`}>
      <span>
        {iconName ? <Icon name={iconName} className="chip-icon" /> : null}
        {label}
      </span>
      {busy ? (
        <span className="count-chip-busy">
          <span className="spinner button-spinner" aria-hidden="true" />
          Selecting…
        </span>
      ) : (
        <strong>{value.toLocaleString()}</strong>
      )}
    </span>
  )
}

function SectionHeader({ title, help }: { title: string; help?: string }) {
  return (
    <div className="action-section-header">
      <span>{title}</span>
      {help ? <InfoTip label={help} /> : null}
    </div>
  )
}

function isCleanNumberInput(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
}

export function ActionToolbar() {
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    selectedCells,
    isSelecting,
    previewCells,
    cellState,
    auditLog,
    undoStack,
    transformHistory,
    requireReason,
    setRequireReason,
    replaceSelectedTargets,
    blankSelectedTargets,
    blankMarkedInCurrentColumn,
    imputeMissingValues,
    undoLastActionGroup,
  } = useDataInspectorStore()
  const [replacementValue, setReplacementValue] = useState('')
  const [replacementMessage, setReplacementMessage] = useState('')
  const [reasonCategory, setReasonCategory] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingCleaningAction | null>(null)
  const [showQcReport, setShowQcReport] = useState(false)
  const [reasonError, setReasonError] = useState('')
  const [exportType, setExportType] = useState<ExportType>('csv')
  const [exportNameDraft, setExportNameDraft] = useState<{ sourceFileName?: string; value: string }>({
    sourceFileName: undefined,
    value: 'data-inspector',
  })
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportKind, setExportKind] = useState<'data' | 'audit' | null>(null)
  const [exportError, setExportError] = useState('')
  const [activeTab, setActiveTab] = useState<'actions' | 'audit'>('actions')
  const [actionBusy, setActionBusy] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const targetCount = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)]).size
  const selectedCount = Object.keys(selectedCells).length
  const exportName =
    exportNameDraft.sourceFileName === workbook?.fileName
      ? exportNameDraft.value
      : fileStem(workbook?.fileName)

  useEffect(() => {
    if (exportStatus !== 'ready') {
      return
    }

    const timeout = window.setTimeout(() => setExportStatus('idle'), 3500)
    return () => window.clearTimeout(timeout)
  }, [exportStatus])

  const { sheetCounts, selectedColumnCounts } = useMemo(() => {
    const emptyCounts: Record<CellMark, number> = {
      review: 0,
      problem: 0,
      keep: 0,
      custom: 0,
      blanked: 0,
      imputed: 0,
    }
    const nextSheetCounts = { ...emptyCounts }
    const nextSelectedColumnCounts = { ...emptyCounts }

    if (!sheet) {
      return { sheetCounts: nextSheetCounts, selectedColumnCounts: nextSelectedColumnCounts }
    }

    sheet.rows.forEach((_row, rowIndex) => {
      sheet.columns.forEach((column) => {
        const state = cellState[makeCellId(sheet.name, rowIndex, column)]
        const mark = state?.valueOverride === null ? 'blanked' : state?.mark
        if (!mark) {
          return
        }

        nextSheetCounts[mark] += 1
        if (column === selectedColumn) {
          nextSelectedColumnCounts[mark] += 1
        }
      })
    })

    return { sheetCounts: nextSheetCounts, selectedColumnCounts: nextSelectedColumnCounts }
  }, [cellState, selectedColumn, sheet])

  const selectedColumnIsNumeric = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return false
    }

    return findNumericColumns(sheet.rows, sheet.columns).includes(selectedColumn)
  }, [selectedColumn, sheet])

  const { imputeTargetCount, hasNonMissingValues } = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return { imputeTargetCount: 0, hasNonMissingValues: false }
    }

    const columnTargetIds = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)])
    const rowIndexes = Array.from(columnTargetIds)
      .filter((cellId) => {
        const parsed = parseCellId(cellId)
        return parsed.sheetName === sheet.name && parsed.columnName === selectedColumn
      })
      .map((cellId) => parseCellId(cellId).rowIndex)
    const candidateRowIndexes = rowIndexes.length > 0 ? rowIndexes : sheet.rows.map((_, rowIndex) => rowIndex)

    const missingCount = candidateRowIndexes.filter((rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      return isMissing(getEffectiveValue(sheet.rows[rowIndex]?.[selectedColumn], cellState[cellId]))
    }).length

    return {
      imputeTargetCount: missingCount,
      hasNonMissingValues: getVisibleColumnValues(sheet, selectedColumn, cellState).length > 0,
    }
  }, [cellState, previewCells, selectedCells, selectedColumn, sheet])

  function parseReplacementValue(): string | number | null {
    const trimmed = replacementValue.trim()
    if (trimmed === '') {
      return null
    }

    if (selectedColumnIsNumeric && isCleanNumberInput(trimmed)) {
      return Number(trimmed)
    }

    return trimmed
  }

  function actionReason(): AuditReasonInput {
    const previewMethods = Array.from(new Set(Object.values(previewCells).map((cell) => cell.method)))
    return {
      reasonCategory: reasonCategory || undefined,
      reasonNote: reasonNote.trim() || undefined,
      methodContext:
        previewMethods.length > 0
          ? `Acted after preview: ${previewMethods.join(', ')}`
          : undefined,
    }
  }

  function openReasonPrompt(action: PendingCleaningAction) {
    setPendingAction(action)
    setReasonCategory('')
    setReasonNote('')
    setReasonError('')
  }

  function closeReasonPrompt() {
    setPendingAction(null)
    setReasonCategory('')
    setReasonNote('')
    setReasonError('')
    setReplacementMessage('Action canceled. No values were changed.')
  }

  function pendingActionLabel(): string {
    if (!pendingAction) {
      return ''
    }

    if (pendingAction.kind === 'replace') {
      return `Apply replacement to ${pendingAction.count.toLocaleString()} value${pendingAction.count === 1 ? '' : 's'}`
    }

    if (pendingAction.kind === 'blankSelected') {
      return `Apply blanking to ${pendingAction.count.toLocaleString()} value${pendingAction.count === 1 ? '' : 's'}`
    }

    if (pendingAction.kind === 'blankProblem') {
      return `Apply blanking to ${pendingAction.count.toLocaleString()} problem value${pendingAction.count === 1 ? '' : 's'}`
    }

    if (pendingAction.kind === 'blankReview') {
      return `Apply blanking to ${pendingAction.count.toLocaleString()} review value${pendingAction.count === 1 ? '' : 's'}`
    }

    const methodLabel = IMPUTATION_METHOD_OPTIONS.find((option) => option.value === pendingAction.method)?.label ?? 'fill'
    return `${methodLabel} for ${pendingAction.count.toLocaleString()} missing value${pendingAction.count === 1 ? '' : 's'}`
  }

  function pendingActionHelper(): string {
    if (!pendingAction) {
      return ''
    }

    if (pendingAction.kind === 'replace') {
      return `Selected values will use "${String(pendingAction.value)}" in the cleaned export. Raw data stays unchanged.`
    }

    if (pendingAction.kind === 'blankSelected') {
      return 'Selected and previewed values will be blanked in the cleaned export. Rows are not deleted.'
    }

    if (pendingAction.kind === 'impute') {
      return 'Only currently missing cells (selected, previewed, or across the whole column) are filled. Cells that already have a value are never touched. Raw data stays unchanged.'
    }

    return 'Matching values in the active sheet and selected column will be blanked in the cleaned export. Rows are not deleted.'
  }

  // Shared by the reason-modal confirm path and the "Require reason" OFF immediate-apply path --
  // reason is omitted entirely (rather than passed as empty strings) for the immediate path, so
  // the audit log records these fields as blank exactly like any other reason-less store call.
  function applyCleaningAction(action: PendingCleaningAction, reason?: AuditReasonInput) {
    if (action.kind === 'replace') {
      replaceSelectedTargets(action.value, reason)
      setReplacementMessage(
        `Replacement applied to ${action.count.toLocaleString()} selected value${action.count === 1 ? '' : 's'}.`,
      )
    } else if (action.kind === 'blankSelected') {
      blankSelectedTargets(reason)
      setReplacementMessage(
        `${action.count.toLocaleString()} selected or previewed value${action.count === 1 ? '' : 's'} replaced with blank.`,
      )
    } else if (action.kind === 'blankProblem') {
      blankMarkedInCurrentColumn('problem', reason)
      setReplacementMessage(
        `${action.count.toLocaleString()} problem value${action.count === 1 ? '' : 's'} replaced with blank.`,
      )
    } else if (action.kind === 'blankReview') {
      blankMarkedInCurrentColumn('review', reason)
      setReplacementMessage(
        `${action.count.toLocaleString()} review value${action.count === 1 ? '' : 's'} replaced with blank.`,
      )
    } else {
      const { appliedCount, skippedCount } = imputeMissingValues(action.method, reason)
      const skipNote =
        action.method === 'interpolate' && skippedCount > 0
          ? ` (${skippedCount.toLocaleString()} not filled: no neighbor)`
          : ''
      setReplacementMessage(`${appliedCount.toLocaleString()} value${appliedCount === 1 ? '' : 's'} filled.${skipNote}`)
    }
  }

  // Entry point for the four blank/replace buttons: applies immediately (no prompt, reason left
  // blank) when "Require reason" is off, otherwise opens the reason modal as before. Fill-missing
  // (impute) actions always go straight to openReasonPrompt and are unaffected by the toggle.
  function runCleaningAction(action: PendingCleaningAction) {
    if (!requireReason) {
      if (actionBusy) {
        return
      }
      setActionBusy(true)
      window.setTimeout(() => {
        try {
          applyCleaningAction(action)
        } catch (caughtError) {
          setReplacementMessage(caughtError instanceof Error ? caughtError.message : 'Action failed. Please try again.')
        } finally {
          setActionBusy(false)
        }
      }, 0)
      return
    }

    openReasonPrompt(action)
  }

  function confirmReasonPrompt() {
    if (!pendingAction || actionBusy) {
      return
    }

    if (!hasCompleteAuditReason(reasonCategory, reasonNote)) {
      setReasonError('Choose a reason category and add a note before applying this change.')
      return
    }

    const reason = actionReason()
    const action = pendingAction

    setActionBusy(true)
    window.setTimeout(() => {
      try {
        applyCleaningAction(action, reason)
        setPendingAction(null)
        setReasonCategory('')
        setReasonNote('')
        setReasonError('')
      } catch (caughtError) {
        setReasonError(caughtError instanceof Error ? caughtError.message : 'Action failed. Please try again.')
      } finally {
        setActionBusy(false)
      }
    }, 0)
  }

  function handleReplaceSelected() {
    const parsedValue = parseReplacementValue()
    if (parsedValue === null) {
      setReplacementMessage('Enter a new value first. Use blanking to clear values.')
      return
    }

    if (selectedCount === 0) {
      setReplacementMessage('Select one or more values first.')
      return
    }

    runCleaningAction({ kind: 'replace', value: parsedValue, count: selectedCount })
  }

  function handleUndo() {
    if (undoBusy || undoStack.length === 0) {
      return
    }
    setUndoBusy(true)
    window.setTimeout(() => {
      try {
        undoLastActionGroup()
      } finally {
        setUndoBusy(false)
      }
    }, 0)
  }

  function safeExportName(): string {
    return fileStem(exportName || workbook?.fileName || 'data-inspector')
  }

  function exportCsv() {
    if (!sheet) {
      return
    }
    downloadCsv(`${safeExportName()}-${sheet.name}.csv`, buildCleanedCsv(sheet, cellState))
  }

  function exportAuditLogCsv() {
    downloadCsv(`${safeExportName()}-audit-log.csv`, buildAuditLogCsv(auditLog))
  }

  async function exportXlsx() {
    if (!workbook) {
      return
    }
    await downloadHighlightedXlsxWorkbook(`${safeExportName()}.xlsx`, workbook, cellState)
  }

  function handleDataExport() {
    setExportStatus('preparing')
    setExportError('')
    setExportKind('data')

    window.setTimeout(async () => {
      try {
        setExportStatus('applying')

        if (exportType === 'csv') {
          exportCsv()
          setExportStatus('ready')
          return
        }

        if (exportType === 'xlsx') {
          setExportStatus('creating')
          await exportXlsx()
          setExportStatus('ready')
        }
      } catch (error) {
        setExportStatus('failed')
        setExportError(error instanceof Error ? error.message : 'Export failed.')
      }
    }, 0)
  }

  function handleAuditExport() {
    setExportStatus('preparing')
    setExportError('')
    setExportKind('audit')

    window.setTimeout(() => {
      try {
        exportAuditLogCsv()
        setExportStatus('ready')
      } catch (error) {
        setExportStatus('failed')
        setExportError(error instanceof Error ? error.message : 'Export failed.')
      }
    }, 0)
  }

  const isExportDisabled =
    (exportType === 'csv' && !sheet) ||
    (exportType === 'xlsx' && !workbook)
  const isExportBusy = exportStatus === 'preparing' || exportStatus === 'applying' || exportStatus === 'creating'
  const isDataExportBusy = isExportBusy && exportKind === 'data'
  const isAuditExportBusy = isExportBusy && exportKind === 'audit'
  const statusText =
    exportStatus === 'preparing'
      ? 'Preparing export...'
      : exportStatus === 'applying'
        ? 'Applying changes...'
        : exportStatus === 'creating'
          ? 'Creating workbook...'
          : exportStatus === 'ready'
            ? 'Download ready.'
            : exportStatus === 'failed'
              ? `Export failed${exportError ? `: ${exportError}` : '.'}`
              : ''

  return (
    <aside className="panel action-panel">
      <div className="action-tab-bar">
        <button
          type="button"
          className={`action-tab${activeTab === 'actions' ? ' action-tab-active' : ''}`}
          onClick={() => setActiveTab('actions')}
        >
          Actions
        </button>
        <button
          type="button"
          className={`action-tab${activeTab === 'audit' ? ' action-tab-active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <Icon name="clipboard" />
          Audit log
          {auditLog.length > 0 && (
            <span className="action-tab-badge">{auditLog.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'audit' ? (
        <AuditLogPanel
          onExport={handleAuditExport}
          onGenerateReport={() => setShowQcReport(true)}
          isExporting={isAuditExportBusy}
        />
      ) : (
      <div className="action-tab-content">
      <div className="panel-title">Actions</div>

      <section className="action-section">
        <SectionHeader title="Status" />
        <div className="chip-grid">
          <CountChip label="Selected" value={Object.keys(selectedCells).length} busy={isSelecting} />
          <CountChip label="Preview" value={Object.keys(previewCells).length} tone="preview" />
          <CountChip label="Review" value={sheetCounts.review} tone="review" />
          <CountChip label="Problem" value={sheetCounts.problem} tone="problem" />
          <CountChip label="Accepted" value={sheetCounts.keep} tone="keep" />
          <CountChip label="Custom" value={sheetCounts.custom} tone="custom" />
          <CountChip label="Blanked" value={sheetCounts.blanked} tone="blanked" />
          <CountChip label="Imputed" value={sheetCounts.imputed} tone="imputed" />
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Cleaning"
          help="Replacements and blanking affect cleaned exports only. Raw data stays unchanged and rows are never deleted."
        />
        <div className="button-group">
          <label className="transform-checkbox-row">
            <input
              type="checkbox"
              checked={requireReason}
              onChange={(event) => setRequireReason(event.target.checked)}
            />
            Require reason for changes
          </label>
          <p className="audit-cue">
            {requireReason
              ? 'Cleaning actions require a reason. The reason is saved only in the Audit Log CSV.'
              : 'Cleaning actions apply immediately. The audit log entry is saved with no reason.'}
          </p>
          <label className="field replacement-field">
            <span>New value</span>
            <input
              value={replacementValue}
              onChange={(event) => {
                setReplacementValue(event.target.value)
                setReplacementMessage('')
              }}
              placeholder="Enter replacement"
              aria-label="New replacement value"
            />
          </label>
          <button
            type="button"
            onClick={handleReplaceSelected}
            disabled={selectedCount === 0 || replacementValue.trim() === '' || actionBusy}
            title="Replaces selected values in cleaned exports. Raw data is not changed."
          >
            <Icon name="swap" />
            Replace selected with new value
          </button>
          {replacementMessage ? <p className="hint action-message">{replacementMessage}</p> : null}
          <button
            type="button"
            className="danger-soft"
            onClick={() => runCleaningAction({ kind: 'blankSelected', count: targetCount })}
            disabled={targetCount === 0 || actionBusy}
            title="Selected or previewed values become blank in the cleaned export. Rows are not deleted."
          >
            <Icon name="eraser" />
            Replace selected values with blank
          </button>
          <button
            type="button"
            onClick={() =>
              runCleaningAction({ kind: 'blankProblem', count: selectedColumnCounts.problem })
            }
            disabled={selectedColumnCounts.problem === 0 || actionBusy}
            title="Replaces all red Problem cells in the current sheet and selected column with blank in the cleaned export."
          >
            <Icon name="alert" className="problem-icon" />
            Replace problem with blank
          </button>
          <button
            type="button"
            onClick={() =>
              runCleaningAction({ kind: 'blankReview', count: selectedColumnCounts.review })
            }
            disabled={selectedColumnCounts.review === 0 || actionBusy}
            title="Replaces all yellow Review cells in the current sheet and selected column with blank in the cleaned export."
          >
            <Icon name="flag" className="review-icon" />
            Replace review with blank
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0 || undoBusy}
            title="Reverses the most recent grouped mark, replace, remove highlight, or blank action."
          >
            {undoBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="undo" />}
            Undo last action
          </button>
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Fill missing values"
          help="Fills only cells that are currently missing -- selected or previewed missing cells if you have a selection, otherwise every missing cell in the current column. Cells that already have a value are never touched. Raw data stays unchanged; this is a controlled overlay like replace and blank."
        />
        <div className="button-group">
          <p className="hint compact-help">
            {imputeTargetCount.toLocaleString()} missing value{imputeTargetCount === 1 ? '' : 's'} eligible in{' '}
            {selectedColumn || 'the current column'}.
          </p>
          {IMPUTATION_METHOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => openReasonPrompt({ kind: 'impute', method: option.value, count: imputeTargetCount })}
              disabled={imputeTargetCount === 0 || !hasNonMissingValues}
              title={
                option.value === 'interpolate'
                  ? 'Interpolates each missing value from the nearest non-missing values above and below it in row order. Cells at a column edge with no neighbor on one side are skipped.'
                  : `Fills each missing value with the column's current ${option.value}, computed from its currently visible (non-blanked) numeric values.`
              }
            >
              <Icon name="fill" />
              {option.label}
            </button>
          ))}
        </div>
        {actionBusy && pendingAction?.kind === 'impute' ? (
          <div className="panel-loading-overlay" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>Filling values…</span>
          </div>
        ) : null}
      </section>

      <section className="action-section export-section">
        <SectionHeader title="Export" />
        <div className="export-grid">
          <input
            className="export-name-input"
            value={exportName}
            onChange={(event) =>
              setExportNameDraft({ sourceFileName: workbook?.fileName, value: event.target.value })
            }
            placeholder="File name"
            aria-label="Export file name"
          />
          <select
            className="export-format-select"
            value={exportType}
            onChange={(event) => setExportType(event.target.value as ExportType)}
            aria-label="Export format"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
          <button
            type="button"
            className="primary-action export-data-btn"
            onClick={handleDataExport}
            disabled={isExportDisabled || isExportBusy}
          >
            {isDataExportBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="download" />}
            Export data
          </button>
          <button
            type="button"
            className="export-audit-btn"
            onClick={handleAuditExport}
            disabled={auditLog.length === 0 || isExportBusy}
            title="Exports highlights, blanks, removals, and undo actions as a separate audit file."
          >
            {isAuditExportBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="clipboard" />}
            Export audit log
          </button>
          {statusText ? (
            <p className={exportStatus === 'failed' ? 'error-text export-status' : 'hint export-status'}>
              {statusText}
            </p>
          ) : null}
          <p className="export-info">
            CSV: active sheet &nbsp;·&nbsp; XLSX: workbook with highlights &nbsp;·&nbsp; Audit log: full change history
          </p>
        </div>
      </section>
      {pendingAction ? (
        <ModalPortal>
          <div
            className="reason-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reason-dialog-title"
          >
            <div className="reason-modal-header">
              <div>
                <h2 id="reason-dialog-title">Reason for change</h2>
                <p>Please explain this change before applying it. This reason will be saved in the audit log.</p>
              </div>
            </div>
            <div className="reason-modal-action">{pendingActionLabel()}</div>
            <p className="reason-modal-helper">{pendingActionHelper()}</p>
            <label className="field">
              <span>Reason category</span>
              <select
                value={reasonCategory}
                onChange={(event) => {
                  setReasonCategory(event.target.value)
                  setReasonError('')
                }}
                aria-label="Reason category"
              >
                <option value="">Choose a reason</option>
                {reasonCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Note</span>
              <textarea
                value={reasonNote}
                onChange={(event) => {
                  setReasonNote(event.target.value)
                  setReasonError('')
                }}
                rows={4}
                placeholder="Why are you changing this value?"
                aria-label="Reason note"
                autoFocus
              />
            </label>
            {reasonError ? <p className="error-text">{reasonError}</p> : null}
            <div className="modal-actions">
              <button type="button" onClick={closeReasonPrompt} disabled={actionBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={confirmReasonPrompt}
                disabled={!hasCompleteAuditReason(reasonCategory, reasonNote) || actionBusy}
              >
                {actionBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
                Apply change
              </button>
            </div>
          </div>
        </ModalPortal>
      ) : null}
      </div>
      )}

      {showQcReport && workbook ? (
        <QcReportModal
          workbook={workbook}
          cellState={cellState}
          auditLog={auditLog}
          transformHistory={transformHistory}
          onClose={() => setShowQcReport(false)}
        />
      ) : null}
    </aside>
  )
}
