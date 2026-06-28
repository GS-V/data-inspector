import { useMemo } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellId } from '../types/data'
import { makeCellId, parseCellId } from '../utils/cellId'
import { getDisplayValue, getEffectiveValue } from '../utils/numeric'

export function SelectionTable() {
  const { workbook, activeSheetName, selectedColumn, selectedCells, previewCells, cellState, auditLog, toggleSelectedCell } =
    useDataInspectorStore()
  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)

  const rows = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return []
    }

    const cellIds = new Set<CellId>([...Object.keys(selectedCells), ...Object.keys(previewCells)])
    sheet.rows.forEach((_row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const state = cellState[cellId]
      if (state?.mark || Object.prototype.hasOwnProperty.call(state ?? {}, 'valueOverride')) {
        cellIds.add(cellId)
      }
    })

    return Array.from(cellIds)
      .filter((cellId) => {
        const parsed = parseCellId(cellId)
        return parsed.sheetName === sheet.name && parsed.columnName === selectedColumn
      })
      .map((cellId) => {
        const { rowIndex } = parseCellId(cellId)
        const rawRow = sheet.rows[rowIndex]
        const state = cellState[cellId]
        const preview = previewCells[cellId]
        const latestReason = auditLog
          .filter((action) => action.cellId === cellId && (action.reasonCategory || action.reasonNote))
          .at(-1)
        const isModified =
          Boolean(state) &&
          Object.prototype.hasOwnProperty.call(state, 'valueOverride') &&
          state?.valueOverride !== null
        return {
          cellId,
          rowIndex,
          value: getEffectiveValue(rawRow?.[selectedColumn], state),
          mark: state?.mark ?? '',
          highlightColor: state?.highlightColor,
          isModified,
          isSelected: Boolean(selectedCells[cellId]),
          previewMethod: preview?.method ?? '',
          previewReason: preview?.reason ?? '',
          reasonCategory: latestReason?.reasonCategory ?? '',
          reasonNote: latestReason?.reasonNote ?? '',
        }
      })
      .sort((first, second) => first.rowIndex - second.rowIndex)
  }, [auditLog, cellState, previewCells, selectedCells, selectedColumn, sheet])

  function markClass(mark: string) {
    return mark ? `mark-pill ${mark}` : 'mark-pill empty'
  }

  function markLabel(mark: string) {
    if (mark === 'keep') {
      return 'Accepted'
    }
    if (mark === 'review') {
      return 'Review'
    }
    if (mark === 'problem') {
      return 'Problem'
    }
    if (mark === 'blanked') {
      return 'Blanked'
    }
    if (mark === 'custom') {
      return 'Custom'
    }
    return '-'
  }

  const queueSummary = {
    selected: rows.filter((row) => row.isSelected).length,
    previewed: rows.filter((row) => row.previewMethod).length,
    modified: rows.filter((row) => row.isModified).length,
    accepted: rows.filter((row) => row.mark === 'keep').length,
    problem: rows.filter((row) => row.mark === 'problem').length,
    review: rows.filter((row) => row.mark === 'review').length,
  }

  return (
    <section className="panel table-panel">
      <div className="panel-title with-tip">
        <span className="queue-title">
          Review Queue
          <span className="queue-count">{rows.length.toLocaleString()}</span>
        </span>
        <InfoTip label="Rows currently selected, previewed, highlighted, or changed." />
      </div>
      {rows.length === 0 ? (
        <p className="hint">Select points, preview suggestions, or highlight values to see rows here.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Value column</th>
                  <th>Value</th>
                  <th>Current mark</th>
                  <th>Selected</th>
                  <th>Preview method</th>
                  <th>Preview reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.cellId}
                    className={row.isSelected ? 'selectable-row selected-row' : 'selectable-row'}
                    tabIndex={0}
                    title="Click to select or unselect this cell."
                    onClick={() => toggleSelectedCell(row.cellId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleSelectedCell(row.cellId)
                      }
                    }}
                  >
                    <td>{row.rowIndex + 1}</td>
                    <td>{selectedColumn}</td>
                    <td>{getDisplayValue(row.value) || '(blank)'}</td>
                    <td>
                      <span className="mark-stack">
                        {row.mark ? (
                          <span
                            className={markClass(row.mark)}
                            style={
                              row.mark === 'custom' && row.highlightColor
                                ? { borderColor: row.highlightColor, backgroundColor: row.highlightColor, color: '#111827' }
                                : undefined
                            }
                          >
                            {markLabel(row.mark)}
                          </span>
                        ) : null}
                        {row.isModified ? <span className="mark-pill modified">Modified</span> : null}
                        {row.reasonCategory ? (
                          <span className="mark-pill reason" title={row.reasonNote || row.reasonCategory}>
                            {row.reasonCategory}
                          </span>
                        ) : null}
                        {!row.mark && !row.isModified && !row.reasonCategory ? (
                          <span className="mark-pill empty">-</span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className={row.isSelected ? 'status-pill selected' : 'status-pill'}>
                        {row.isSelected ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>{row.previewMethod || '-'}</td>
                    <td>{row.previewReason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="queue-footer" aria-label="Review Queue summary">
            <span>{rows.length.toLocaleString()} rows shown</span>
            <span>Selected: {queueSummary.selected.toLocaleString()}</span>
            <span>Previewed: {queueSummary.previewed.toLocaleString()}</span>
            <span>Modified: {queueSummary.modified.toLocaleString()}</span>
            <span>Accepted: {queueSummary.accepted.toLocaleString()}</span>
            <span>Problem: {queueSummary.problem.toLocaleString()}</span>
            <span>Review: {queueSummary.review.toLocaleString()}</span>
          </div>
        </>
      )}
    </section>
  )
}
