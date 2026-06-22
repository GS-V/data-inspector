import { useMemo, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellMark } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { buildAuditLogCsv, buildCleanedCsv, downloadCsv } from '../utils/exportCsv'

type ExportType = 'cleaned-csv' | 'highlighted-xlsx' | 'audit-csv'

function fileStem(fileName: string | undefined): string {
  return (fileName ?? 'data-inspector').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-')
}

function CountChip({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className={`count-chip ${tone ?? ''}`}>
      {label} <strong>{value.toLocaleString()}</strong>
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
    markTargets,
    clearTargetMarks,
    blankSelectedTargets,
    blankMarkedInCurrentColumn,
    undoLastActionGroup,
    clearPreview,
    clearSelection,
  } = useDataInspectorStore()
  const [exportType, setExportType] = useState<ExportType>('cleaned-csv')

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const targetCount = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)]).size

  const { sheetCounts, selectedColumnCounts } = useMemo(() => {
    const emptyCounts: Record<CellMark, number> = {
      review: 0,
      problem: 0,
      keep: 0,
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

  function exportCleanedCsv() {
    if (!sheet) {
      return
    }
    downloadCsv(`${fileStem(workbook?.fileName)}-${sheet.name}-cleaned.csv`, buildCleanedCsv(sheet, cellState))
  }

  function exportAuditLogCsv() {
    downloadCsv(`${fileStem(workbook?.fileName)}-audit-log.csv`, buildAuditLogCsv(auditLog))
  }

  function handleExport() {
    if (exportType === 'cleaned-csv') {
      exportCleanedCsv()
    }

    if (exportType === 'audit-csv') {
      exportAuditLogCsv()
    }
  }

  const isExportDisabled =
    (exportType === 'cleaned-csv' && !sheet) ||
    // The installed SheetJS xlsx writer does not reliably preserve cell fill styles.
    // A style-capable writer such as exceljs is needed before offering colored XLSX export.
    (exportType === 'highlighted-xlsx') ||
    (exportType === 'audit-csv' && auditLog.length === 0)

  return (
    <aside className="panel action-panel">
      <div className="panel-title">Workflow Actions</div>

      <section className="action-section">
        <SectionHeader title="Status" />
        <div className="chip-grid">
          <CountChip label="Selected" value={Object.keys(selectedCells).length} />
          <CountChip label="Preview" value={Object.keys(previewCells).length} tone="preview" />
          <CountChip label="Review" value={sheetCounts.review} tone="review" />
          <CountChip label="Problem" value={sheetCounts.problem} tone="problem" />
          <CountChip label="Keep" value={sheetCounts.keep} tone="keep" />
          <CountChip label="Blanked" value={sheetCounts.blanked} tone="blanked" />
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Highlight"
          help="Marks are persistent highlights. They are exported, unlike temporary selections and previews."
        />
        <div className="mark-grid">
          <button
            type="button"
            className="review-button"
            onClick={() => markTargets('review')}
            disabled={targetCount === 0}
            title="Yellow highlight. Use for values you want to inspect later."
          >
            Review
          </button>
          <button
            type="button"
            className="problem-button"
            onClick={() => markTargets('problem')}
            disabled={targetCount === 0}
            title="Red highlight. Use for values that are likely incorrect."
          >
            Problem
          </button>
          <button
            type="button"
            className="keep-button"
            onClick={() => markTargets('keep')}
            disabled={targetCount === 0}
            title="Green highlight. Use for values you reviewed and decided to keep."
          >
            Keep
          </button>
          <button
            type="button"
            onClick={clearTargetMarks}
            disabled={targetCount === 0}
            title="Removes persistent highlights from selected or previewed cells."
          >
            Clear
          </button>
        </div>
        <p className="hint">Review = yellow, Problem = red, Keep = green.</p>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Selection"
          help="Click points to select them. Click again to unselect. Drag to select many points."
        />
        <div className="compact-button-row">
          <button type="button" onClick={clearSelection} disabled={Object.keys(selectedCells).length === 0}>
            Clear Selection
          </button>
          <button type="button" onClick={clearPreview} disabled={Object.keys(previewCells).length === 0}>
            Clear Preview
          </button>
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Clean"
          help="Blanking replaces values with empty cells. Rows are never deleted."
        />
        <div className="button-group">
          <button
            type="button"
            className="danger-soft"
            onClick={blankSelectedTargets}
            disabled={targetCount === 0}
            title="Replaces selected or previewed values with blank. Rows are not deleted."
          >
            Blank Selected
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('problem')}
            disabled={selectedColumnCounts.problem === 0}
            title="Blanks all red Problem cells in the current sheet and selected column."
          >
            Blank all Problem
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('review')}
            disabled={selectedColumnCounts.review === 0}
            title="Blanks all yellow Review cells in the current sheet and selected column."
          >
            Blank all Review
          </button>
          <button
            type="button"
            onClick={undoLastActionGroup}
            disabled={undoStack.length === 0}
            title="Restores the most recent marking or blanking action."
          >
            Undo
          </button>
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Export"
          help="Cleaned CSV exports cleaned values. Highlighted XLSX is the planned colored export path. Audit Log CSV exports action history."
        />
        <label className="field export-field">
          <span>Export type</span>
          <select value={exportType} onChange={(event) => setExportType(event.target.value as ExportType)}>
            <option value="cleaned-csv">Cleaned CSV</option>
            <option value="highlighted-xlsx" disabled>
              Highlighted XLSX - not available yet
            </option>
            <option value="audit-csv">Audit Log CSV</option>
          </select>
        </label>
        <button type="button" className="primary-action" onClick={handleExport} disabled={isExportDisabled}>
          Export
        </button>
        <p className="hint export-note">
          Cleaned CSV exports cleaned values and blanked cells. CSV does not store colors. Highlighted XLSX needs a
          style-capable Excel writer and will be added next.
        </p>
      </section>
    </aside>
  )
}
