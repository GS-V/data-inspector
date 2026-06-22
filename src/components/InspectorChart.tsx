import Plot from 'react-plotly.js'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import { ROW_ORDER_AXIS } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { getDisplayValue, getEffectiveValue, toNumber } from '../utils/numeric'

type PlotPointEvent = {
  points?: Array<{
    customdata?: unknown
  }>
}

function markColor(mark: string | undefined, isBlanked: boolean): string {
  if (isBlanked) {
    return '#9ca3af'
  }

  if (mark === 'review') {
    return '#facc15'
  }

  if (mark === 'problem') {
    return '#fb7185'
  }

  if (mark === 'keep') {
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

export function InspectorChart({ theme }: InspectorChartProps) {
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
  } = useDataInspectorStore()

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const chartColors =
    theme === 'dark'
      ? {
          paper: '#141a24',
          plot: '#111827',
          text: '#e5e7eb',
          grid: '#334155',
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
        <div className="chart-tip">Tip: switch to Scatter to click or drag-select individual values.</div>
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
            xaxis: { title: selectedColumn, zeroline: false, gridcolor: chartColors.grid },
            yaxis: { title: 'Count', zeroline: false, gridcolor: chartColors.grid },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            bargap: 0.05,
          }}
          config={{ displaylogo: false, responsive: true }}
          style={{ width: '100%', height: '460px' }}
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
      const selectedOutline = theme === 'dark' ? '#f8fafc' : '#111827'

      return {
        x: xValue,
        y: yValue,
        cellId,
        color: markColor(state?.mark, isBlanked),
        lineColor: isSelected ? selectedOutline : isPreviewed ? '#7c3aed' : '#ffffff',
        lineWidth: isSelected ? 4 : isPreviewed ? 3 : 1,
        size: isSelected ? 12 : isPreviewed ? 10 : 8,
        symbol: isPreviewed ? 'diamond' : 'circle',
        hover: [
          `Row ${rowIndex + 1}`,
          `${selectedColumn}: ${getDisplayValue(getEffectiveValue(row[selectedColumn], state)) || '(blank)'}`,
          state?.mark ? `Mark: ${state.mark}` : '',
          isSelected ? 'Selected' : '',
          isPreviewed ? `Preview: ${previewCells[cellId]?.method}` : '',
        ]
          .filter(Boolean)
          .join('<br>'),
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  return (
    <section className="panel chart-panel">
      <div className="chart-tip">Tip: click points to select them, drag to select many, then mark or blank.</div>
      <Plot
        data={[
          {
            type: 'scattergl',
            mode: 'markers',
            x: points.map((point) => point.x),
            y: points.map((point) => point.y),
            customdata: points.map((point) => point.cellId),
            text: points.map((point) => point.hover),
            hovertemplate: '%{text}<extra></extra>',
            marker: {
              color: points.map((point) => point.color),
              size: points.map((point) => point.size),
              symbol: points.map((point) => point.symbol),
              opacity: 0.88,
              line: {
                color: points.map((point) => point.lineColor),
                width: points.map((point) => point.lineWidth),
              },
            },
          },
        ]}
        layout={{
          autosize: true,
          dragmode: 'select',
          selectdirection: 'any',
          margin: { l: 56, r: 24, t: 24, b: 52 },
          font: { color: chartColors.text },
          xaxis: {
            title: xAxis === ROW_ORDER_AXIS ? 'Row order' : xAxis,
            zeroline: false,
            gridcolor: chartColors.grid,
          },
          yaxis: { title: selectedColumn, zeroline: false, gridcolor: chartColors.grid },
          paper_bgcolor: chartColors.paper,
          plot_bgcolor: chartColors.plot,
          hovermode: 'closest',
        }}
        config={{
          displaylogo: false,
          responsive: true,
          modeBarButtonsToAdd: ['select2d', 'lasso2d'],
        }}
        style={{ width: '100%', height: '460px' }}
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
          }
        }}
      />
    </section>
  )
}
