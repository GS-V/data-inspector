import { useEffect, useMemo, useState } from 'react'
import { AuditLogPanel } from './AuditLogPanel'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { AuditReasonInput } from '../store/useDataInspectorStore'
import type { CellMark } from '../types/data'
import { hasCompleteAuditReason } from '../utils/auditReason'
import { makeCellId } from '../utils/cellId'
import { buildAuditLogCsv, buildCleanedCsv, downloadCsv, downloadHighlightedXlsxWorkbook } from '../utils/exportCsv'
import { findNumericColumns } from '../utils/numeric'

type ExportType = 'csv' | 'xlsx'
type ExportStatus = 'idle' | 'preparing' | 'applying' | 'creating' | 'ready' | 'failed'
type PendingCleaningAction =
  | { kind: 'replace'; value: string | number; count: number }
  | { kind: 'blankSelected'; count: number }
  | { kind: 'blankProblem'; count: number }
  | { kind: 'blankReview'; count: number }

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

function CountChip({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const icons: Record<string, string> = {
    selected: '☑',
    preview: '↝',
    review: '⚑',
    problem: '△',
    keep: '✓',
    custom: '◇',
    blanked: '◉',
  }

  return (
    <span className={`count-chip ${tone ?? ''}`}>
      <span>
        <span className="chip-icon" aria-hidden="true">{icons[tone ?? 'selected'] ?? '•'}</span>
        {label}
      </span>
      <strong>{value.toLocaleString()}</strong>
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
    previewCells,
    cellState,
    auditLog,
    undoStack,
    replaceSelectedTargets,
    blankSelectedTargets,
    blankMarkedInCurrentColumn,
    undoLastActionGroup,
  } = useDataInspectorStore()
  const [replacementValue, setReplacementValue] = useState('')
  const [replacementMessage, setReplacementMessage] = useState('')
  const [reasonCategory, setReasonCategory] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingCleaningAction | null>(null)
  const [reasonError, setReasonError] = useState('')
  const [exportType, setExportType] = useState<ExportType>('csv')
  const [exportNameDraft, setExportNameDraft] = useState<{ sourceFileName?: string; value: string }>({
    sourceFileName: undefined,
    value: 'data-inspector',
  })
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportError, setExportError] = useState('')
  const [activeTab, setActiveTab] = useState<'actions' | 'audit'>('actions')

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

    return `Apply blanking to ${pendingAction.count.toLocaleString()} review value${pendingAction.count === 1 ? '' : 's'}`
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

    return 'Matching values in the active sheet and selected column will be blanked in the cleaned export. Rows are not deleted.'
  }

  function confirmReasonPrompt() {
    if (!pendingAction) {
      return
    }

    if (!hasCompleteAuditReason(reasonCategory, reasonNote)) {
      setReasonError('Choose a reason category and add a note before applying this change.')
      return
    }

    const reason = actionReason()
    if (pendingAction.kind === 'replace') {
      replaceSelectedTargets(pendingAction.value, reason)
      setReplacementMessage(
        `Replacement applied to ${pendingAction.count.toLocaleString()} selected value${pendingAction.count === 1 ? '' : 's'}.`,
      )
    } else if (pendingAction.kind === 'blankSelected') {
      blankSelectedTargets(reason)
      setReplacementMessage(
        `${pendingAction.count.toLocaleString()} selected or previewed value${pendingAction.count === 1 ? '' : 's'} replaced with blank.`,
      )
    } else if (pendingAction.kind === 'blankProblem') {
      blankMarkedInCurrentColumn('problem', reason)
      setReplacementMessage(
        `${pendingAction.count.toLocaleString()} problem value${pendingAction.count === 1 ? '' : 's'} replaced with blank.`,
      )
    } else {
      blankMarkedInCurrentColumn('review', reason)
      setReplacementMessage(
        `${pendingAction.count.toLocaleString()} review value${pendingAction.count === 1 ? '' : 's'} replaced with blank.`,
      )
    }

    setPendingAction(null)
    setReasonCategory('')
    setReasonNote('')
    setReasonError('')
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

    openReasonPrompt({ kind: 'replace', value: parsedValue, count: selectedCount })
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
          <span className="button-icon" aria-hidden="true">▤</span>
          Audit log
          {auditLog.length > 0 && (
            <span className="action-tab-badge">{auditLog.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'audit' ? (
        <AuditLogPanel onExport={handleAuditExport} />
      ) : (
      <div className="action-tab-content">
      <div className="panel-title">Actions</div>

      <section className="action-section">
        <SectionHeader title="Status" />
        <div className="chip-grid">
          <CountChip label="Selected" value={Object.keys(selectedCells).length} />
          <CountChip label="Preview" value={Object.keys(previewCells).length} tone="preview" />
          <CountChip label="Review" value={sheetCounts.review} tone="review" />
          <CountChip label="Problem" value={sheetCounts.problem} tone="problem" />
          <CountChip label="Accepted" value={sheetCounts.keep} tone="keep" />
          <CountChip label="Custom" value={sheetCounts.custom} tone="custom" />
          <CountChip label="Blanked" value={sheetCounts.blanked} tone="blanked" />
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Cleaning"
          help="Replacements and blanking affect cleaned exports only. Raw data stays unchanged and rows are never deleted."
        />
        <div className="button-group">
          <p className="audit-cue">
            Cleaning actions require a reason. The reason is saved only in the Audit Log CSV.
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
            disabled={selectedCount === 0 || replacementValue.trim() === ''}
            title="Replaces selected values in cleaned exports. Raw data is not changed."
          >
            <span className="button-icon" aria-hidden="true">↔</span>
            Replace selected with new value
          </button>
          {replacementMessage ? <p className="hint action-message">{replacementMessage}</p> : null}
          <button
            type="button"
            className="danger-soft"
            onClick={() => openReasonPrompt({ kind: 'blankSelected', count: targetCount })}
            disabled={targetCount === 0}
            title="Selected or previewed values become blank in the cleaned export. Rows are not deleted."
          >
            <span className="button-icon" aria-hidden="true">→</span>
            Replace selected values with blank
          </button>
          <button
            type="button"
            onClick={() =>
              openReasonPrompt({ kind: 'blankProblem', count: selectedColumnCounts.problem })
            }
            disabled={selectedColumnCounts.problem === 0}
            title="Replaces all red Problem cells in the current sheet and selected column with blank in the cleaned export."
          >
            <span className="button-icon problem-icon" aria-hidden="true">△</span>
            Replace problem with blank
          </button>
          <button
            type="button"
            onClick={() =>
              openReasonPrompt({ kind: 'blankReview', count: selectedColumnCounts.review })
            }
            disabled={selectedColumnCounts.review === 0}
            title="Replaces all yellow Review cells in the current sheet and selected column with blank in the cleaned export."
          >
            <span className="button-icon review-icon" aria-hidden="true">⚑</span>
            Replace review with blank
          </button>
          <button
            type="button"
            onClick={undoLastActionGroup}
            disabled={undoStack.length === 0}
            title="Reverses the most recent grouped mark, replace, remove highlight, or blank action."
          >
            <span className="button-icon" aria-hidden="true">↶</span>
            Undo last action
          </button>
        </div>
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
            disabled={isExportDisabled}
          >
            <span className="button-icon" aria-hidden="true">⇩</span>
            Export data
          </button>
          <button
            type="button"
            className="export-audit-btn"
            onClick={handleAuditExport}
            disabled={auditLog.length === 0}
            title="Exports highlights, blanks, removals, and undo actions as a separate audit file."
          >
            <span className="button-icon" aria-hidden="true">▤</span>
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
        <div className="modal-backdrop" role="presentation">
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
              <button type="button" onClick={closeReasonPrompt}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={confirmReasonPrompt}
                disabled={!hasCompleteAuditReason(reasonCategory, reasonNote)}
              >
                Apply change
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
      )}
    </aside>
  )
}
