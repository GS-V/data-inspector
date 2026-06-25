import { useEffect, useMemo, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellMark } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { buildAuditLogCsv, buildCleanedCsv, downloadCsv, downloadHighlightedXlsxWorkbook } from '../utils/exportCsv'

type ExportType = 'csv' | 'xlsx'
type ExportStatus = 'idle' | 'preparing' | 'applying' | 'creating' | 'ready' | 'failed'

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
    blankSelectedTargets,
    blankMarkedInCurrentColumn,
    undoLastActionGroup,
  } = useDataInspectorStore()
  const [exportType, setExportType] = useState<ExportType>('csv')
  const [exportNameDraft, setExportNameDraft] = useState<{ sourceFileName?: string; value: string }>({
    sourceFileName: undefined,
    value: 'data-inspector',
  })
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportError, setExportError] = useState('')

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const targetCount = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)]).size
  const isXlsxSource = workbook?.fileName.toLowerCase().endsWith('.xlsx') || workbook?.fileName.toLowerCase().endsWith('.xls')
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
          help="Blanking affects the cleaned export only. Raw data stays unchanged and rows are never deleted."
        />
        <div className="button-group">
          <button
            type="button"
            className="danger-soft"
            onClick={blankSelectedTargets}
            disabled={targetCount === 0}
            title="Selected or previewed values become blank in the cleaned export. Rows are not deleted."
          >
            <span className="button-icon" aria-hidden="true">→</span>
            Replace selected values with blank
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('problem')}
            disabled={selectedColumnCounts.problem === 0}
            title="Replaces all red Problem cells in the current sheet and selected column with blank in the cleaned export."
          >
            <span className="button-icon problem-icon" aria-hidden="true">△</span>
            Replace problem with blank
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('review')}
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
            title="Reverses the most recent grouped mark, remove highlight, or blank action."
          >
            <span className="button-icon" aria-hidden="true">↶</span>
            Undo last action
          </button>
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Export"
          help="CSV exports values only. XLSX exports a workbook with blanked values and highlight colors applied."
        />
        <label className="field export-field">
          <span>File name</span>
          <input
            value={exportName}
            onChange={(event) =>
              setExportNameDraft({ sourceFileName: workbook?.fileName, value: event.target.value })
            }
            placeholder="data-inspector"
            aria-label="Export file name"
          />
        </label>
        <label className="field export-field">
          <span>Format</span>
          <select value={exportType} onChange={(event) => setExportType(event.target.value as ExportType)}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
        </label>
        <button type="button" className="primary-action" onClick={handleDataExport} disabled={isExportDisabled}>
          <span className="button-icon" aria-hidden="true">⇩</span>
          Export
        </button>
        <button
          type="button"
          onClick={handleAuditExport}
          disabled={auditLog.length === 0}
          title="Exports highlights, blanks, removals, and undo actions as a separate audit file."
        >
          <span className="button-icon" aria-hidden="true">▤</span>
          Export Audit Log CSV
        </button>
        {statusText ? (
          <p className={exportStatus === 'failed' ? 'error-text export-status' : 'hint export-status'}>
            {statusText}
          </p>
        ) : null}
        <p className="hint export-note">
          {isXlsxSource
            ? 'CSV exports the active sheet with blanked values applied and no colors. XLSX exports the workbook with blanked values and highlight colors applied. Audit Log CSV is separate.'
            : 'CSV exports the active sheet with blanked values applied and no colors. XLSX creates a workbook with blanked values and highlight colors applied. Audit Log CSV is separate.'}
        </p>
      </section>
    </aside>
  )
}
