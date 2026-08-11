import { useState } from 'react'
import Plot from 'react-plotly.js'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellState } from '../types/data'
import { ROW_ORDER_AXIS } from '../types/data'
import { makeCellId } from '../utils/cellId'
import {
  computeBoxPlotStats,
  computeCdfPoints,
  computeDensityPoints,
  computeQQPlotPoints,
  fitReferenceLine,
  getVisibleColumnValues,
  type VisibleColumnValue,
} from '../utils/chartData'
import { getDisplayValue, getEffectiveValue, toNumber } from '../utils/numeric'
import { formatNumber } from '../utils/stats'

type PlotPointEvent = {
  points?: Array<{
    customdata?: unknown
  }>
}

function markColor(state: CellState | undefined, isBlanked: boolean): string {
  if (isBlanked) {
    return '#9ca3af'
  }

  if (state?.mark === 'custom') {
    return state.highlightColor ?? '#a855f7'
  }

  if (state?.mark === 'review') {
    return '#facc15'
  }

  if (state?.mark === 'problem') {
    return '#fb7185'
  }

  if (state?.mark === 'keep') {
    return '#22c55e'
  }

  return '#3b82f6'
}

function eventCellIds(event: unknown): string[] {
  if (!event) {
    return []
  }

  const plotEvent = event as PlotPointEvent
  return Array.from(
    new Set(
      (plotEvent.points ?? [])
        .map((point) => point.customdata)
        .filter((value): value is string => typeof value === 'string'),
    ),
  )
}

type InspectorChartProps = {
  theme: 'light' | 'dark'
}

type ChartPoint = {
  x: number
  y: number
  cellId: string
  color: string
  size: number
  opacity: number
  hover: string
  isPreviewed: boolean
  isSelected: boolean
}

function pointTrace(points: ChartPoint[], traceType: 'scatter' | 'scattergl' = 'scattergl') {
  return {
    type: traceType,
    mode: 'markers',
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    customdata: points.map((point) => point.cellId),
    text: points.map((point) => point.hover),
    hovertemplate: '%{text}<extra></extra>',
  }
}

export function InspectorChart({ theme }: InspectorChartProps) {
  const [emptySelectionVersion, setEmptySelectionVersion] = useState(0)
  const [showBlankedPoints, setShowBlankedPoints] = useState(true)
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    xAxis,
    plotType,
    selectedCells,
    previewCells,
    cellState,
    toggleSelectedCell,
    addSelectedCells,
    clearSelection,
    clearPreview,
  } = useDataInspectorStore()

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const chartColors =
    theme === 'dark'
      ? {
          paper: '#141a24',
          plot: '#0c1726',
          text: '#e5e7eb',
          grid: '#243349',
          histogram: '#60a5fa',
          histogramLine: '#93c5fd',
        }
      : {
          paper: '#ffffff',
          plot: '#ffffff',
          text: '#111827',
          grid: '#e5e7eb',
          histogram: '#3b82f6',
          histogramLine: '#1d4ed8',
        }

  if (!sheet || !selectedColumn) {
    return (
      <section className="panel chart-panel empty-state">
        <strong>Open a file to begin.</strong>
        <span>CSV and XLSX files stay local in this browser session.</span>
      </section>
    )
  }

  function renderBlankedToggleActions() {
    return (
      <>
        <button type="button" onClick={() => setShowBlankedPoints((current) => !current)}>
          {showBlankedPoints ? 'Hide blanked points' : 'Show blanked points'}
        </button>
        <button
          type="button"
          onClick={() => {
            clearSelection()
            setEmptySelectionVersion((version) => version + 1)
          }}
        >
          Clear selection
        </button>
        <button type="button" onClick={clearPreview} disabled={Object.keys(previewCells).length === 0}>
          Clear preview
        </button>
      </>
    )
  }

  function renderPointChart(
    points: ChartPoint[],
    options: {
      keyPrefix: string
      tip: string
      xAxisTitle: string
      yAxisTitle: string
      extraTraces?: unknown[]
    },
  ) {
    const { keyPrefix, tip, xAxisTitle, yAxisTitle, extraTraces = [] } = options
    const previewPoints = points.filter((point) => point.isPreviewed)
    const selectedPoints = points.filter((point) => point.isSelected)
    const selectedOutline = theme === 'dark' ? '#f8fafc' : '#111827'
    const densePreview = previewPoints.length > 500
    const denseSelection = selectedPoints.length > 500

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">{tip}</div>
          <div className="chart-actions">{renderBlankedToggleActions()}</div>
        </div>
        <Plot
          revision={emptySelectionVersion}
          key={`${keyPrefix}-${emptySelectionVersion}`}
          data={[
            ...extraTraces,
            {
              ...pointTrace(points),
              name: 'Values',
              marker: {
                color: points.map((point) => point.color),
                size: points.map((point) => point.size),
                opacity: points.map((point) => point.opacity),
                line: {
                  color: theme === 'dark' ? '#1f2937' : '#ffffff',
                  width: 1,
                },
              },
            },
            {
              ...pointTrace(previewPoints, 'scatter'),
              name: 'Preview suggestion',
              marker: {
                color: '#8b5cf6',
                size: densePreview ? 12 : 16,
                symbol: 'diamond-open',
                line: { color: '#8b5cf6', width: densePreview ? 1.5 : 3 },
              },
              showlegend: false,
            },
            {
              ...pointTrace(selectedPoints, 'scatter'),
              name: 'Selected',
              marker: {
                color: selectedOutline,
                size: denseSelection ? 14 : 19,
                symbol: 'circle-open',
                line: { color: selectedOutline, width: denseSelection ? 2 : 4 },
              },
              showlegend: false,
            },
          ]}
          layout={{
            autosize: true,
            dragmode: 'select',
            selectdirection: 'any',
            margin: { l: 56, r: 24, t: 24, b: 52 },
            font: { color: chartColors.text },
            xaxis: {
              title: { text: xAxisTitle },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            yaxis: {
              title: { text: yAxisTitle },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            hovermode: 'closest',
            showlegend: false,
          }}
          config={{
            displaylogo: false,
            displayModeBar: true,
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToAdd: ['select2d', 'lasso2d'],
            modeBarButtonsToRemove: ['toImage'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onClick={(event) => {
            const [cellId] = eventCellIds(event)
            if (cellId) {
              if (Object.keys(previewCells).length > 0) {
                clearPreview()
              }
              toggleSelectedCell(cellId)
            }
          }}
          onSelected={(event) => {
            const cellIds = eventCellIds(event)
            if (cellIds.length > 0) {
              clearPreview()
              clearSelection()
              addSelectedCells(cellIds)
              return
            }
            setEmptySelectionVersion((version) => version + 1)
          }}
        />
      </section>
    )
  }

  if (plotType === 'histogram') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">Tip: switch to Scatter to click or drag-select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions()}</div>
        </div>
        <Plot
          data={[
            {
              type: 'histogram',
              x: values,
              marker: { color: chartColors.histogram, line: { color: chartColors.histogramLine, width: 1 } },
            },
          ]}
          layout={{
            autosize: true,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            xaxis: {
              title: { text: `Value column: ${selectedColumn}` },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            yaxis: {
              title: { text: 'Count' },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            bargap: 0.05,
          }}
          config={{
            displaylogo: false,
            displayModeBar: true,
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToRemove: ['toImage'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </section>
    )
  }

  if (plotType === 'box' || plotType === 'violin') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState)
    const stats = computeBoxPlotStats(values)

    const trace =
      plotType === 'box'
        ? {
            type: 'box',
            y: values.map((entry) => entry.value),
            customdata: values.map((entry) => entry.cellId),
            name: selectedColumn,
            boxpoints: 'outliers',
            marker: { color: chartColors.histogram, outliercolor: '#fb7185' },
            line: { color: chartColors.histogramLine },
          }
        : {
            type: 'violin',
            y: values.map((entry) => entry.value),
            customdata: values.map((entry) => entry.cellId),
            name: selectedColumn,
            points: 'outliers',
            box: { visible: true },
            meanline: { visible: true },
            marker: { color: chartColors.histogram },
            line: { color: chartColors.histogramLine },
          }

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">
            {stats
              ? `Q1=${formatNumber(stats.q1)} · Median=${formatNumber(stats.median)} · Q3=${formatNumber(stats.q3)} · Outliers=${stats.outliers.length}. Only outlier points are clickable — switch to Scatter to select other values.`
              : 'Not enough numeric values to compute this chart.'}
          </div>
          <div className="chart-actions">{renderBlankedToggleActions()}</div>
        </div>
        <Plot
          data={[trace]}
          layout={{
            autosize: true,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            xaxis: {
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            yaxis: {
              title: { text: `Value column: ${selectedColumn}` },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            showlegend: false,
          }}
          config={{
            displaylogo: false,
            displayModeBar: true,
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToRemove: ['toImage'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onClick={(event) => {
            const [cellId] = eventCellIds(event)
            if (cellId) {
              if (Object.keys(previewCells).length > 0) {
                clearPreview()
              }
              toggleSelectedCell(cellId)
            }
          }}
        />
      </section>
    )
  }

  if (plotType === 'density') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    const densityPoints = computeDensityPoints(values)

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">Read-only view of the estimated distribution shape (Gaussian KDE). Switch to Scatter to select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions()}</div>
        </div>
        <Plot
          data={[
            {
              type: 'scatter',
              mode: 'lines',
              x: densityPoints.map((point) => point.x),
              y: densityPoints.map((point) => point.y),
              fill: 'tozeroy',
              fillcolor: theme === 'dark' ? 'rgba(96, 165, 250, 0.25)' : 'rgba(59, 130, 246, 0.2)',
              line: { color: chartColors.histogramLine, width: 2 },
              hovertemplate: `${selectedColumn}: %{x:.3f}<br>Density: %{y:.4f}<extra></extra>`,
            },
          ]}
          layout={{
            autosize: true,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            xaxis: {
              title: { text: `Value column: ${selectedColumn}` },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            yaxis: {
              title: { text: 'Density' },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            showlegend: false,
          }}
          config={{
            displaylogo: false,
            displayModeBar: true,
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToRemove: ['toImage'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </section>
    )
  }

  if (plotType === 'cdf') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    const cdfPoints = computeCdfPoints(values)

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">Read-only view of the empirical cumulative distribution. Switch to Scatter to select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions()}</div>
        </div>
        <Plot
          data={[
            {
              type: 'scatter',
              mode: 'lines',
              line: { color: chartColors.histogramLine, width: 2, shape: 'hv' },
              x: cdfPoints.map((point) => point.x),
              y: cdfPoints.map((point) => point.y),
              hovertemplate: `${selectedColumn}: %{x:.3f}<br>Cumulative probability: %{y:.3f}<extra></extra>`,
            },
          ]}
          layout={{
            autosize: true,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            xaxis: {
              title: { text: `Value column: ${selectedColumn}` },
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            yaxis: {
              title: { text: 'Cumulative probability' },
              range: [0, 1],
              zeroline: false,
              gridcolor: chartColors.grid,
              automargin: true,
            },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            showlegend: false,
          }}
          config={{
            displaylogo: false,
            displayModeBar: true,
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToRemove: ['toImage'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </section>
    )
  }

  if (plotType === 'qq') {
    const visibleEntries: VisibleColumnValue[] = []
    sheet.rows.forEach((row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const state = cellState[cellId]
      const isBlanked = state?.valueOverride === null || state?.mark === 'blanked'
      if (isBlanked && !showBlankedPoints) {
        return
      }

      const value = toNumber(isBlanked ? row[selectedColumn] : getEffectiveValue(row[selectedColumn], state))
      if (value === null) {
        return
      }

      visibleEntries.push({ rowIndex, cellId, value })
    })

    const qqEntries = computeQQPlotPoints(visibleEntries)
    const entryByCellId = new Map(visibleEntries.map((entry) => [entry.cellId, entry]))

    const points: ChartPoint[] = qqEntries.map(({ cellId, theoretical, sample }) => {
      const entry = entryByCellId.get(cellId)
      const rowIndex = entry?.rowIndex ?? 0
      const state = cellState[cellId]
      const isBlanked = state?.valueOverride === null || state?.mark === 'blanked'
      const isSelected = Boolean(selectedCells[cellId])
      const isPreviewed = Boolean(previewCells[cellId])

      return {
        x: theoretical,
        y: sample,
        cellId,
        color: markColor(state, isBlanked),
        size: isBlanked ? 8 : 9,
        opacity: isBlanked ? 0.52 : 0.88,
        isPreviewed,
        isSelected,
        hover: [
          `Row ${rowIndex + 1}`,
          `Value column: ${selectedColumn}`,
          `Sample quantile: ${formatNumber(sample)}`,
          `Theoretical quantile: ${formatNumber(theoretical)}`,
          isBlanked ? 'Cleaned export: blank' : '',
          isSelected ? 'Selected' : '',
          isPreviewed ? `Suggested by preview: ${previewCells[cellId]?.method}` : '',
        ]
          .filter(Boolean)
          .join('<br>'),
      }
    })

    const referenceLine = fitReferenceLine(qqEntries.map((entry) => ({ x: entry.theoretical, y: entry.sample })))
    const extraTraces: unknown[] = []
    if (referenceLine) {
      const theoreticalValues = qqEntries.map((entry) => entry.theoretical)
      const xMin = Math.min(...theoreticalValues)
      const xMax = Math.max(...theoreticalValues)
      extraTraces.push({
        type: 'scatter',
        mode: 'lines',
        x: [xMin, xMax],
        y: [xMin * referenceLine.slope + referenceLine.intercept, xMax * referenceLine.slope + referenceLine.intercept],
        line: { color: chartColors.histogramLine, dash: 'dash', width: 1.5 },
        hoverinfo: 'skip',
        showlegend: false,
        name: 'Reference line',
      })
    }

    return renderPointChart(points, {
      keyPrefix: 'qq',
      tip: 'Tip: click points to select. Points close to the dashed line suggest a normal distribution.',
      xAxisTitle: 'Theoretical normal quantiles',
      yAxisTitle: `Sample quantiles / value column: ${selectedColumn}`,
      extraTraces,
    })
  }

  const points = sheet.rows
    .map((row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const state = cellState[cellId]
      const isBlanked = state?.valueOverride === null || state?.mark === 'blanked'
      if (isBlanked && !showBlankedPoints) {
        return null
      }
      const yValue = toNumber(isBlanked ? row[selectedColumn] : getEffectiveValue(row[selectedColumn], state))
      const xValue =
        xAxis === ROW_ORDER_AXIS
          ? rowIndex + 1
          : toNumber(getEffectiveValue(row[xAxis], cellState[makeCellId(sheet.name, rowIndex, xAxis)]))

      if (xValue === null || yValue === null) {
        return null
      }

      const isSelected = Boolean(selectedCells[cellId])
      const isPreviewed = Boolean(previewCells[cellId])
      const effectiveValue = getEffectiveValue(row[selectedColumn], state)

      return {
        x: xValue,
        y: yValue,
        cellId,
        color: markColor(state, isBlanked),
        size: isBlanked ? 8 : 9,
        opacity: isBlanked ? 0.52 : 0.88,
        isPreviewed,
        isSelected,
        hover: [
          `Row ${rowIndex + 1}`,
          `Y-axis / value column: ${selectedColumn}`,
          `Value: ${getDisplayValue(effectiveValue) || '(blank)'}`,
          `X-axis: ${xAxis === ROW_ORDER_AXIS ? 'Row order' : xAxis}`,
          state?.mark
            ? `Highlight: ${
                state.mark === 'keep'
                  ? 'accepted'
                  : state.mark === 'custom'
                    ? `custom ${state.highlightColor ?? ''}`.trim()
                    : state.mark
              }`
            : '',
          isBlanked ? 'Cleaned export: blank' : '',
          isSelected ? 'Selected' : '',
          isPreviewed ? `Suggested by preview: ${previewCells[cellId]?.method}` : '',
        ]
          .filter(Boolean)
          .join('<br>'),
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  return renderPointChart(points, {
    keyPrefix: 'scatter',
    tip: 'Tip: click points to select. Drag to select many. Use the toolbar to zoom or reset.',
    xAxisTitle: `X-axis: ${xAxis === ROW_ORDER_AXIS ? 'Row order' : xAxis}`,
    yAxisTitle: `Y-axis / value column: ${selectedColumn}`,
  })
}
