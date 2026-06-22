import { useMemo } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellId } from '../types/data'
import { makeCellId, parseCellId } from '../utils/cellId'
import { getDisplayValue, getEffectiveValue } from '../utils/numeric'

export function SelectionTable() {
  const { workbook, activeSheetName, selectedColumn, selectedCells, previewCells, cellState } =
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
        return {
          cellId,
          rowIndex,
          value: getEffectiveValue(rawRow?.[selectedColumn], state),
          mark: state?.mark ?? '',
          isSelected: Boolean(selectedCells[cellId]),
          previewMethod: preview?.method ?? '',
          previewReason: preview?.reason ?? '',
        }
      })
      .sort((first, second) => first.rowIndex - second.rowIndex)
  }, [cellState, previewCells, selectedCells, selectedColumn, sheet])

  function markClass(mark: string) {
    return mark ? `mark-pill ${mark}` : 'mark-pill empty'
  }

  return (
    <section className="panel table-panel">
      <div className="panel-title with-tip">
        <span>Selected, Previewed, and Marked Rows</span>
        <InfoTip label="This table shows temporary selections, temporary previews, and persistent marks for the selected column." />
      </div>
      {rows.length === 0 ? (
        <p className="hint">Select points, run a preview, or mark values to see row context here.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Column</th>
                <th>Value</th>
                <th>Current mark</th>
                <th>Selected</th>
                <th>Preview method</th>
                <th>Preview reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cellId}>
                  <td>{row.rowIndex + 1}</td>
                  <td>{selectedColumn}</td>
                  <td>{getDisplayValue(row.value) || '(blank)'}</td>
                  <td>
                    <span className={markClass(row.mark)}>{row.mark || '-'}</span>
                  </td>
                  <td>
                    <span className={row.isSelected ? 'status-pill selected' : 'status-pill'}>{row.isSelected ? 'Yes' : 'No'}</span>
                  </td>
                  <td>{row.previewMethod || '-'}</td>
                  <td>{row.previewReason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
