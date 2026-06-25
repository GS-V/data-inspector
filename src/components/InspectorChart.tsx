import { useState } from 'react'
import Plot from 'react-plotly.js'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellState } from '../types/data'
import { ROW_ORDER_AXIS } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { getDisplayValue, getEffectiveValue, toNumber } from '../utils/numeric'

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

  if (plotType === 'histogram') {
    const values = sheet.rows
      .map((row, rowIndex) => {
        const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
        const state = cellState[cellId]
        if (state?.valueOverride === null) {
          return null
        }
        return toNumber(getEffectiveValue(row[selectedColumn], state))
      })
      .filter((value): value is number => value !== null)

    return (
      <section className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tip">Tip: switch to Scatter to click or drag-select values.</div>
          <div className="chart-actions">
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
          </div>
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

  const previewPoints = points.filter((point) => point.isPreviewed)
  const selectedPoints = points.filter((point) => point.isSelected)
  const selectedOutline = theme === 'dark' ? '#f8fafc' : '#111827'

  return (
    <section className="panel chart-panel">
      <div className="chart-toolbar">
        <div className="chart-tip">Tip: click points to select. Drag to select many. Use the toolbar to zoom or reset.</div>
        <div className="chart-actions">
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
        </div>
      </div>
      <Plot
        revision={emptySelectionVersion}
        key={`scatter-${emptySelectionVersion}`}
        data={[
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
              size: 16,
              symbol: 'diamond-open',
              line: { color: '#8b5cf6', width: 3 },
            },
            showlegend: false,
          },
          {
            ...pointTrace(selectedPoints, 'scatter'),
            name: 'Selected',
            marker: {
              color: selectedOutline,
              size: 19,
              symbol: 'circle-open',
              line: { color: selectedOutline, width: 4 },
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
            title: { text: `X-axis: ${xAxis === ROW_ORDER_AXIS ? 'Row order' : xAxis}` },
            zeroline: false,
            gridcolor: chartColors.grid,
            automargin: true,
          },
          yaxis: {
            title: { text: `Y-axis / value column: ${selectedColumn}` },
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
            toggleSelectedCell(cellId)
          }
        }}
        onSelected={(event) => {
          const cellIds = eventCellIds(event)
          if (cellIds.length > 0) {
            addSelectedCells(cellIds)
            return
          }
          setEmptySelectionVersion((version) => version + 1)
        }}
      />
    </section>
  )
}
