import { useMemo, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellMark } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { buildAuditLogCsv, buildCleanedCsv, downloadCleanedXlsxWorkbook, downloadCsv } from '../utils/exportCsv'

type ExportType = 'cleaned-csv' | 'cleaned-xlsx' | 'highlighted-xlsx' | 'audit-csv'

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
    blankSelectedTargets,
    blankMarkedInCurrentColumn,
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

  function exportCleanedXlsx() {
    if (!workbook) {
      return
    }
    downloadCleanedXlsxWorkbook(`${fileStem(workbook.fileName)}-cleaned.xlsx`, workbook, cellState)
  }

  function handleExport() {
    if (exportType === 'cleaned-csv') {
      exportCleanedCsv()
    }

    if (exportType === 'cleaned-xlsx') {
      exportCleanedXlsx()
    }

    if (exportType === 'audit-csv') {
      exportAuditLogCsv()
    }
  }

  const isExportDisabled =
    (exportType === 'cleaned-csv' && !sheet) ||
    (exportType === 'cleaned-xlsx' && !workbook) ||
    // The installed SheetJS xlsx writer does not reliably preserve cell fill styles.
    // A style-capable writer such as exceljs is needed before offering colored XLSX export.
    (exportType === 'highlighted-xlsx') ||
    (exportType === 'audit-csv' && auditLog.length === 0)
  const isXlsxSource = workbook?.fileName.toLowerCase().endsWith('.xlsx') || workbook?.fileName.toLowerCase().endsWith('.xls')

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
          <CountChip label="Accepted" value={sheetCounts.keep} tone="keep" />
          <CountChip label="Blanked" value={sheetCounts.blanked} tone="blanked" />
        </div>
      </section>

      <section className="action-section">
        {/* TODO: Reintroduce grouped undo/redo after action history is stabilized. */}
        <SectionHeader
          title="Clean"
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
            Replace selected values with blank
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('problem')}
            disabled={selectedColumnCounts.problem === 0}
            title="Replaces all red Problem cells in the current sheet and selected column with blank in the cleaned export."
          >
            Replace Problem with blank
          </button>
          <button
            type="button"
            onClick={() => blankMarkedInCurrentColumn('review')}
            disabled={selectedColumnCounts.review === 0}
            title="Replaces all yellow Review cells in the current sheet and selected column with blank in the cleaned export."
          >
            Replace Review with blank
          </button>
        </div>
      </section>

      <section className="action-section">
        <SectionHeader
          title="Export"
          help="Cleaned CSV exports the current sheet with cleaned values. Highlighted XLSX is disabled until styled Excel writing is added. Audit Log CSV records mark, remove, blank, and undo actions."
        />
        <label className="field export-field">
          <span>Export type</span>
          <select value={exportType} onChange={(event) => setExportType(event.target.value as ExportType)}>
            <option value="cleaned-csv">Cleaned CSV</option>
            <option value="cleaned-xlsx">Cleaned XLSX workbook</option>
            <option value="highlighted-xlsx" disabled>
              Highlighted XLSX workbook (coming later)
            </option>
            <option value="audit-csv">Audit Log CSV</option>
          </select>
        </label>
        <button type="button" className="primary-action" onClick={handleExport} disabled={isExportDisabled}>
          Export
        </button>
        <p className="hint export-note">
          Cleaned CSV exports the current sheet with blanked cells empty. Audit Log CSV records mark, remove, blank, and undo actions.
          {isXlsxSource
            ? ' XLSX loaded: CSV export uses the active sheet only. Cleaned XLSX exports all sheets without colors.'
            : ' Cleaned XLSX exports all sheets without colors.'}
        </p>
      </section>
    </aside>
  )
}
