import { useDataInspectorStore } from '../store/useDataInspectorStore'
import { ROW_ORDER_AXIS } from '../types/data'
import { findNumericColumns } from '../utils/numeric'

export function InspectorControls() {
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    xAxis,
    plotType,
    setActiveSheetName,
    setSelectedColumn,
    setXAxis,
    setPlotType,
  } = useDataInspectorStore()

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const numericColumns = findNumericColumns(sheet?.rows ?? [], sheet?.columns ?? [])
  const sheetOptions = workbook?.sheets ?? []

  return (
    <section className="panel controls-panel">
      <div className="panel-title">Inspect</div>
      <label className="field">
        <span>Sheet</span>
        <select
          value={activeSheetName}
          onChange={(event) => setActiveSheetName(event.target.value)}
          disabled={!workbook}
        >
          {sheetOptions.map((sheetOption) => (
            <option key={sheetOption.name} value={sheetOption.name}>
              {sheetOption.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Numeric column</span>
        <select
          value={selectedColumn}
          onChange={(event) => setSelectedColumn(event.target.value)}
          disabled={numericColumns.length === 0}
        >
          {numericColumns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>X-axis</span>
        <select value={xAxis} onChange={(event) => setXAxis(event.target.value)} disabled={!sheet}>
          <option value={ROW_ORDER_AXIS}>Row order</option>
          {numericColumns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Plot type</span>
        <select value={plotType} onChange={(event) => setPlotType(event.target.value as 'scatter' | 'histogram')}>
          <option value="scatter">Scatter</option>
          <option value="histogram">Histogram</option>
        </select>
      </label>

      <p className="hint">Scatter supports click selection and drag selection. Histogram shows the column distribution.</p>

      {sheet && numericColumns.length === 0 ? (
        <p className="hint">No numeric columns were found in this sheet.</p>
      ) : null}
    </section>
  )
}
