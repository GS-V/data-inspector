import { Fragment, useMemo } from 'react'
import { Icon } from './Icon'
import { ModalPortal } from './ModalPortal'
import { NORMALITY_TEST_LABELS, normalityVerdict } from './NormalityResult'
import type { AuditAction, CellState, TransformAttempt, WorkbookData } from '../types/data'
import { actionIconName } from '../utils/auditReason'
import { buildQcReport } from '../utils/qcReport'
import type { QcColumnStat } from '../utils/qcReport'
import { buildQcReportCsv, downloadCsv } from '../utils/exportCsv'
import { formatNumber } from '../utils/stats'

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'data-inspector'
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function NormalityCell({
  result,
  threshold,
}: {
  result: QcColumnStat['normalityBefore']
  threshold: number
}) {
  if (!result) {
    return <span className="hint">-</span>
  }

  const { label, tone } = normalityVerdict(result, threshold)
  return <span className={`normality-badge normality-badge-${tone}`}>{label}</span>
}

export function QcReportModal({
  workbook,
  cellState,
  auditLog,
  transformHistory,
  onClose,
}: {
  workbook: WorkbookData
  cellState: Record<string, CellState>
  auditLog: AuditAction[]
  transformHistory: TransformAttempt[]
  onClose: () => void
}) {
  const report = useMemo(
    () => buildQcReport(workbook, cellState, auditLog, transformHistory),
    [workbook, cellState, auditLog, transformHistory],
  )
  const multiSheet = report.sheetSummaries.length > 1

  function exportPdf() {
    window.print()
  }

  function exportCsvReport() {
    downloadCsv(`${fileStem(workbook.fileName)}-qc-report.csv`, buildQcReportCsv(report))
  }

  return (
    <ModalPortal onBackdropClick={onClose}>
      <div
        className="reason-modal qc-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qc-report-title"
      >
        <div className="reason-modal-header">
          <div>
            <h2 id="qc-report-title">QC Report</h2>
            <p>
              {workbook.fileName} &middot; generated {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>
        </div>

        <section className="qc-report-section">
          <div className="qc-summary-grid">
            <div className="qc-summary-cell">
              <strong>{formatPercent(report.keptRowRatio)}</strong>
              <span>Rows kept unaffected ({report.totalRows.toLocaleString()} total)</span>
            </div>
            <div className="qc-summary-cell">
              <strong>{report.breakdown.blanked.toLocaleString()}</strong>
              <span>Cells blanked</span>
            </div>
            <div className="qc-summary-cell">
              <strong>{report.breakdown.replaced.toLocaleString()}</strong>
              <span>Values replaced</span>
            </div>
          </div>
        </section>

        {multiSheet ? (
          <section className="qc-report-section">
            <h3>By sheet</h3>
            <div className="qc-report-table-wrap">
            <table className="qc-report-table">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Rows</th>
                  <th>Kept</th>
                  <th>Affected</th>
                </tr>
              </thead>
              <tbody>
                {report.sheetSummaries.map((sheetSummary) => (
                  <tr key={sheetSummary.sheetName}>
                    <td>{sheetSummary.sheetName}</td>
                    <td>{sheetSummary.totalRows.toLocaleString()}</td>
                    <td>{formatPercent(sheetSummary.keptRowRatio)}</td>
                    <td>{sheetSummary.affectedRows.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        ) : null}

        <section className="qc-report-section">
          <h3>Cleaning breakdown</h3>
          <div className="chip-grid">
            <span className="count-chip review">
              <span><Icon name={actionIconName('mark_review')} className="chip-icon" />Flagged</span>
              <strong>{report.breakdown.flagged}</strong>
            </span>
            <span className="count-chip problem">
              <span><Icon name={actionIconName('mark_problem')} className="chip-icon" />Problem</span>
              <strong>{report.breakdown.problem}</strong>
            </span>
            <span className="count-chip keep">
              <span><Icon name={actionIconName('mark_keep')} className="chip-icon" />Accepted</span>
              <strong>{report.breakdown.accepted}</strong>
            </span>
            <span className="count-chip custom">
              <span><Icon name={actionIconName('mark_custom')} className="chip-icon" />Custom</span>
              <strong>{report.breakdown.custom}</strong>
            </span>
            <span className="count-chip blanked">
              <span><Icon name={actionIconName('blank_selected')} className="chip-icon" />Blanked</span>
              <strong>{report.breakdown.blanked}</strong>
            </span>
            <span className="count-chip">
              <span><Icon name={actionIconName('replace_value')} className="chip-icon" />Replaced</span>
              <strong>{report.breakdown.replaced}</strong>
            </span>
            <span className="count-chip imputed">
              <span><Icon name={actionIconName('impute_mean')} className="chip-icon" />Imputed</span>
              <strong>{report.breakdown.imputed}</strong>
            </span>
          </div>
        </section>

        <section className="qc-report-section">
          <h3>Before / after statistics</h3>
          <p className="hint">
            Normality: {NORMALITY_TEST_LABELS[report.normalityTestType]}, α = {report.normalityThreshold} -- only computed
            for columns with an applied transform; other columns show &ldquo;-&rdquo;.
          </p>
          <div className="qc-report-table-wrap">
          <table className="qc-report-table">
            <thead>
              <tr>
                {multiSheet ? <th>Sheet</th> : null}
                <th>Column</th>
                <th>Count</th>
                <th>Missing</th>
                <th>Mean</th>
                <th>Median</th>
                <th>SD</th>
                <th>Min</th>
                <th>Max</th>
                <th>Skewness</th>
                <th>Normality</th>
              </tr>
            </thead>
            <tbody>
              {report.columnStats.map((stat) => (
                <Fragment key={`${stat.sheetName}-${stat.columnName}`}>
                  <tr>
                    {multiSheet ? <td>{stat.sheetName}</td> : null}
                    <td>{stat.columnName} <span className="hint">(before)</span></td>
                    <td>{stat.before.count}</td>
                    <td>{stat.before.missingCount}</td>
                    <td>{formatNumber(stat.before.mean)}</td>
                    <td>{formatNumber(stat.before.median)}</td>
                    <td>{formatNumber(stat.before.standardDeviation)}</td>
                    <td>{formatNumber(stat.before.min)}</td>
                    <td>{formatNumber(stat.before.max)}</td>
                    <td>{formatNumber(stat.skewnessBefore)}</td>
                    <td><NormalityCell result={stat.normalityBefore} threshold={report.normalityThreshold} /></td>
                  </tr>
                  <tr>
                    {multiSheet ? <td /> : null}
                    <td className="hint">(after)</td>
                    <td>{stat.after.count}</td>
                    <td>{stat.after.missingCount}</td>
                    <td>{formatNumber(stat.after.mean)}</td>
                    <td>{formatNumber(stat.after.median)}</td>
                    <td>{formatNumber(stat.after.standardDeviation)}</td>
                    <td>{formatNumber(stat.after.min)}</td>
                    <td>{formatNumber(stat.after.max)}</td>
                    <td>{formatNumber(stat.skewnessAfter)}</td>
                    <td><NormalityCell result={stat.normalityAfter} threshold={report.normalityThreshold} /></td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </section>

        <div className="modal-actions no-print">
          <button type="button" onClick={onClose}>
            <Icon name="x-circle" />Close
          </button>
          <button type="button" onClick={exportCsvReport}>
            <Icon name="clipboard" />Export CSV
          </button>
          <button type="button" className="primary-action" onClick={exportPdf}>
            <Icon name="download" />Export PDF
          </button>
        </div>
        <p className="hint no-print">
          Export PDF opens your browser's print dialog — choose "Save as PDF" as the destination.
        </p>
      </div>
    </ModalPortal>
  )
}
