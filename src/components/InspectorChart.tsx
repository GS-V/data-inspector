import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Plot from 'react-plotly.js'
import Plotly from 'plotly.js/dist/plotly'
import { Icon } from './Icon'
import { TableView } from './TableView'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { CellState, RawCellValue } from '../types/data'
import { ROW_ORDER_AXIS } from '../types/data'
import { makeCellId } from '../utils/cellId'
import {
  COMPARISON_COLOR_PALETTE,
  computeBoxPlotStats,
  computeCdfPoints,
  computeDensityPoints,
  computeQQPlotPoints,
  fitReferenceLine,
  getVisibleColumnValues,
  type VisibleColumnValue,
} from '../utils/chartData'
import { getDisplayValue, getEffectiveValue, isDateCol, toNumber } from '../utils/numeric'
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

  if (state?.mark === 'imputed') {
    return '#38bdf8'
  }

  return '#3b82f6'
}

// Resolves a non-row-order X-axis cell to what Plotly should plot it as. A date axis always needs
// the epoch-ms number (paired with layout.xaxis.type: 'date'). Anything else that parses as a
// number stays numeric. A genuine string/categorical value (e.g. "V1") is passed through as-is --
// running it through toNumber() would return null and silently drop the row, which is exactly the
// "X-axis = a string column produces an empty chart" bug this fixes. Plotly renders a string axis
// as categorical ticks automatically.
function resolveAxisValue(effectiveValue: RawCellValue, isDateAxis: boolean): number | string | null {
  if (isDateAxis) {
    return toNumber(effectiveValue)
  }

  const numeric = toNumber(effectiveValue)
  if (numeric !== null) {
    return numeric
  }

  if (effectiveValue === null || effectiveValue === undefined || String(effectiveValue).trim() === '') {
    return null
  }

  return String(effectiveValue)
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
  x: number | string
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
  const [chartAreaHeight, setChartAreaHeight] = useState<number | null>(null)
  const [chartAreaWidth, setChartAreaWidth] = useState<number | null>(null)
  const chartAreaObserverRef = useRef<ResizeObserver | null>(null)
  // The DOM node Plotly itself manages for whichever chart type is currently rendered --
  // <Plot ref={...}> below is forwardRef-wrapped straight through to it. Shared across every
  // branch's <Plot> since only one is ever mounted at a time, this is what Plotly.downloadImage
  // operates on for the export feature.
  const graphDivRef = useRef<HTMLDivElement | null>(null)

  // Plotly's own autosize/useResizeHandler only remeasures on window resize, which leaves a stale
  // fallback height until the next such event (e.g. on first paint, or if the surrounding CSS grid
  // settles for some other reason). A ResizeObserver on the actual plot area keeps chartAreaHeight
  // -- and thus every chart's explicit layout.height below -- correct immediately. chartAreaWidth
  // rides along on the same observer, used only for the export popover's "Current" size preset.
  const chartAreaRef = useCallback((node: HTMLDivElement | null) => {
    chartAreaObserverRef.current?.disconnect()
    chartAreaObserverRef.current = null
    if (!node) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setChartAreaHeight(entry.contentRect.height)
        setChartAreaWidth(entry.contentRect.width)
      }
    })
    observer.observe(node)
    chartAreaObserverRef.current = observer
  }, [])

  useEffect(() => {
    return () => chartAreaObserverRef.current?.disconnect()
  }, [])
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    xAxis,
    plotType,
    comparisonColumns,
    selectedCells,
    previewCells,
    cellState,
    toggleSelectedCell,
    addSelectedCells,
    clearSelection,
    clearPreview,
    setIsSelecting,
  } = useDataInspectorStore()

  // Whether to connect each scatter series with lines -- a transient view preference (not
  // session data, so it lives in local state, not the store) that only makes sense on the
  // scatter view. Reset whenever the user navigates to any other plot type, using React's
  // "adjust state during render" pattern (see react.dev/learn/you-might-not-need-an-effect)
  // rather than an effect, since resetting from inside a useEffect would itself trigger a
  // second, avoidable render.
  const [scatterLinesMode, setScatterLinesMode] = useState(false)
  // Chart export popover -- also transient view state, not session data.
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportWidth, setExportWidth] = useState('800')
  const [exportHeight, setExportHeight] = useState('500')
  const [exportFormat, setExportFormat] = useState<'png' | 'svg'>('png')
  const [exportError, setExportError] = useState<string | null>(null)

  const [lastObservedPlotType, setLastObservedPlotType] = useState(plotType)
  if (plotType !== lastObservedPlotType) {
    setLastObservedPlotType(plotType)
    if (plotType !== 'scatter') {
      setScatterLinesMode(false)
    }
    // The export button (and its popover) only exists inside the chart header, which isn't
    // rendered at all for Table -- close it on any plot-type change so it can't be left open
    // and then silently reappear (still "open" in state) after switching back from Table.
    setIsExportOpen(false)
    setExportError(null)
  }
  // Also gate directly on plotType (not just scatterLinesMode) as cheap defense-in-depth --
  // scatterLinesMode is only ever meaningful while actually on the scatter view.
  const linesEnabled = plotType === 'scatter' && scatterLinesMode

  // Portaled to document.body and positioned via fixed coordinates, same reasoning as the
  // sidebar's "Compare columns" dropdown -- rendered in place, it would clip against
  // .chart-panel's own overflow: hidden as soon as it grew past the panel's edge.
  const [exportPanelPosition, setExportPanelPosition] = useState<{ top: number; right: number } | null>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isExportOpen || !exportButtonRef.current) {
      return
    }

    function updatePosition() {
      const rect = exportButtonRef.current!.getBoundingClientRect()
      setExportPanelPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [isExportOpen])

  useEffect(() => {
    if (!isExportOpen) {
      return
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node
      if (exportButtonRef.current?.contains(target) || exportPanelRef.current?.contains(target)) {
        return
      }
      setIsExportOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isExportOpen])

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)

  // Defers the (potentially heavy) chart computation below by one tick whenever the user picks
  // a different sheet/column/axis/plot type, so a brief "Rendering chart..." state can paint
  // before the main thread blocks on it. Deliberately keyed on these four inputs only -- not
  // cellState -- so routine mark/blank/transform actions elsewhere keep updating this chart in
  // place with no spinner, since that's ordinary reactive re-rendering, not a new computation
  // the user asked for.
  const chartRenderKey = `${activeSheetName}::${selectedColumn}::${xAxis}::${plotType}`
  const [renderedChartKey, setRenderedChartKey] = useState<string | null>(null)
  const isComputingChart = Boolean(sheet && selectedColumn) && renderedChartKey !== chartRenderKey

  useEffect(() => {
    if (!sheet || !selectedColumn || renderedChartKey === chartRenderKey) {
      return
    }
    const timeout = window.setTimeout(() => setRenderedChartKey(chartRenderKey), 0)
    return () => window.clearTimeout(timeout)
  }, [chartRenderKey, renderedChartKey, sheet, selectedColumn])

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

  if (isComputingChart) {
    return (
      <section className="panel chart-panel">
        <div className="panel-loading-overlay" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Rendering chart…</span>
        </div>
      </section>
    )
  }

  if (plotType === 'table') {
    return (
      <section className="panel chart-panel data-grid-panel">
        <TableView sheet={sheet} />
      </section>
    )
  }

  function clampExportDimension(value: string): string {
    const parsed = parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 200) {
      return '200'
    }
    return String(parsed)
  }

  function buildExportFilename(columns: string[]): string {
    const namePart = columns.map((column) => column.replace(/[ .]/g, '_')).join('_')
    return `${namePart}_${plotType}`
  }

  async function handleExportDownload(columns: string[]) {
    const graphDiv = graphDivRef.current
    if (!graphDiv) {
      setExportError('Chart not ready — try again')
      return
    }

    const width = Number(clampExportDimension(exportWidth))
    const height = Number(clampExportDimension(exportHeight))

    try {
      await Plotly.downloadImage(graphDiv, {
        format: exportFormat,
        width,
        height,
        filename: buildExportFilename(columns),
      })
      setIsExportOpen(false)
      setExportError(null)
    } catch {
      setExportError('Export failed — try again')
    }
  }

  function renderExportControl(columns: string[]) {
    return (
      <div className="chart-export">
        <button
          ref={exportButtonRef}
          type="button"
          className="chart-export-toggle"
          aria-label="Export chart"
          aria-expanded={isExportOpen}
          onClick={() => {
            setExportError(null)
            setIsExportOpen((current) => !current)
          }}
          title="Export chart as image"
        >
          <Icon name="download" />
        </button>
        {isExportOpen && exportPanelPosition
          ? createPortal(
              <div
                className="chart-export-panel"
                ref={exportPanelRef}
                style={{ top: exportPanelPosition.top, right: exportPanelPosition.right }}
              >
                <div className="chart-export-dims">
                  <label className="chart-export-field">
                    <span>W px</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={exportWidth}
                      onChange={(event) => setExportWidth(event.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => setExportWidth((current) => clampExportDimension(current))}
                    />
                  </label>
                  <label className="chart-export-field">
                    <span>H px</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={exportHeight}
                      onChange={(event) => setExportHeight(event.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => setExportHeight((current) => clampExportDimension(current))}
                    />
                  </label>
                </div>
                <div className="chart-export-presets">
                  <button
                    type="button"
                    onClick={() => {
                      setExportWidth('600')
                      setExportHeight('600')
                    }}
                  >
                    Square
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportWidth('1200')
                      setExportHeight('600')
                    }}
                  >
                    Wide
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportWidth('600')
                      setExportHeight('900')
                    }}
                  >
                    Portrait
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportWidth(String(Math.round(chartAreaWidth ?? 800)))
                      setExportHeight(String(Math.round(chartAreaHeight ?? 500)))
                    }}
                  >
                    Current
                  </button>
                </div>
                <div className="code-lang-toggle chart-export-format">
                  <button
                    type="button"
                    className={exportFormat === 'png' ? 'code-lang-active' : undefined}
                    onClick={() => setExportFormat('png')}
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    className={exportFormat === 'svg' ? 'code-lang-active' : undefined}
                    onClick={() => setExportFormat('svg')}
                  >
                    SVG
                  </button>
                </div>
                {exportError ? <p className="chart-export-error">{exportError}</p> : null}
                <button
                  type="button"
                  className="chart-export-download"
                  onClick={() => {
                    void handleExportDownload(columns)
                  }}
                >
                  <Icon name="download" />
                  Download
                </button>
              </div>,
              document.body,
            )
          : null}
      </div>
    )
  }

  function renderChartHeader(columns: string[]) {
    return <div className="chart-active-columns">{columns.join(' · ')}</div>
  }

  function renderBlankedToggleActions(options: { columns: string[]; showLinesToggle?: boolean }) {
    const { columns, showLinesToggle = false } = options
    return (
      <>
        <button type="button" onClick={() => setShowBlankedPoints((current) => !current)}>
          <Icon name="eye" />
          {showBlankedPoints ? 'Hide blanked points' : 'Show blanked points'}
        </button>
        <button
          type="button"
          onClick={() => {
            clearSelection()
            setEmptySelectionVersion((version) => version + 1)
          }}
        >
          <Icon name="x-circle" />
          Clear selection
        </button>
        <button type="button" onClick={clearPreview} disabled={Object.keys(previewCells).length === 0}>
          <Icon name="x-circle" />
          Clear preview
        </button>
        {showLinesToggle ? (
          <button
            type="button"
            className="chart-lines-toggle"
            aria-pressed={scatterLinesMode}
            onClick={() => setScatterLinesMode((current) => !current)}
            title="Connect each series' points with lines"
          >
            <Icon name="soften" />
            Lines
          </button>
        ) : null}
        {renderExportControl(columns)}
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
      headerColumns?: string[]
      showLegend?: boolean
      notice?: string
      xAxisType?: 'date'
      showLinesToggle?: boolean
    },
  ) {
    const {
      keyPrefix,
      tip,
      xAxisTitle,
      yAxisTitle,
      extraTraces = [],
      headerColumns = [selectedColumn],
      showLegend = false,
      notice,
      xAxisType,
      showLinesToggle = false,
    } = options
    const previewPoints = points.filter((point) => point.isPreviewed)
    const selectedPoints = points.filter((point) => point.isSelected)
    const selectedOutline = theme === 'dark' ? '#f8fafc' : '#111827'
    const densePreview = previewPoints.length > 500
    const denseSelection = selectedPoints.length > 500

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        {notice ? <p className="hint chart-inline-notice">{notice}</p> : null}
        <div className="chart-toolbar">
          <div className="chart-tip">{tip}</div>
          <div className="chart-actions">
            {renderBlankedToggleActions({ columns: headerColumns, showLinesToggle })}
          </div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          revision={emptySelectionVersion}
          key={`${keyPrefix}-${emptySelectionVersion}`}
          data={[
            ...extraTraces,
            {
              ...pointTrace(points, linesEnabled ? 'scatter' : 'scattergl'),
              name: selectedColumn,
              // Exclusive, not additive: the Lines toggle switches the render mode rather than
              // layering a line on top of the markers, so 'lines' here (not 'lines+markers').
              mode: linesEnabled ? 'lines' : 'markers',
              line: { color: chartColors.histogramLine, width: 1.5 },
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
            height: chartAreaHeight ?? 400,
            dragmode: 'select',
            selectdirection: 'any',
            margin: { l: 56, r: 24, t: 24, b: 52 },
            font: { color: chartColors.text },
            xaxis: {
              title: { text: xAxisTitle },
              type: xAxisType,
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
            showlegend: showLegend,
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
              setIsSelecting(true)
              window.setTimeout(() => {
                try {
                  clearPreview()
                  clearSelection()
                  addSelectedCells(cellIds)
                } finally {
                  setIsSelecting(false)
                }
              }, 0)
              return
            }
            setEmptySelectionVersion((version) => version + 1)
          }}
        />
        </div>
      </section>
    )
  }

  if (plotType === 'histogram') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    // The comparison picker already excludes date columns, and the store's addComparisonColumn
    // rejects them too -- this filter is a defensive backstop against a date column ever reaching
    // the trace builder.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const hasComparisons = validComparisonColumns.length > 0
    const comparisonHistograms = validComparisonColumns.map((column, index) => ({
      type: 'histogram' as const,
      x: getVisibleColumnValues(sheet, column, cellState).map((entry) => entry.value),
      name: column,
      opacity: 0.4,
      marker: { color: COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length] },
    }))

    const headerColumns = hasComparisons ? [selectedColumn, ...validComparisonColumns] : [selectedColumn]

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">Tip: switch to Scatter to click or drag-select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions({ columns: headerColumns })}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[
            {
              type: 'histogram',
              x: values,
              name: selectedColumn,
              opacity: hasComparisons ? 0.4 : 1,
              marker: { color: chartColors.histogram, line: { color: chartColors.histogramLine, width: 1 } },
            },
            ...comparisonHistograms,
          ]}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 400,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            barmode: hasComparisons ? 'overlay' : undefined,
            showlegend: hasComparisons,
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
        </div>
      </section>
    )
  }

  if (plotType === 'box' || plotType === 'violin') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState)
    const stats = computeBoxPlotStats(values)
    // Defensive backstop -- see the matching comment in the histogram branch above.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const hasComparisons = validComparisonColumns.length > 0

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

    const comparisonTraces = validComparisonColumns.map((column, index) => {
      const entries = getVisibleColumnValues(sheet, column, cellState)
      const color = COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length]

      return plotType === 'box'
        ? {
            type: 'box' as const,
            y: entries.map((entry) => entry.value),
            name: column,
            boxpoints: 'outliers',
            marker: { color, outliercolor: color },
            line: { color },
          }
        : {
            type: 'violin' as const,
            y: entries.map((entry) => entry.value),
            name: column,
            points: 'outliers',
            box: { visible: true },
            meanline: { visible: true },
            marker: { color },
            line: { color },
          }
    })

    const headerColumns = hasComparisons ? [selectedColumn, ...validComparisonColumns] : [selectedColumn]

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">
            {stats
              ? `Q1=${formatNumber(stats.q1)} · Median=${formatNumber(stats.median)} · Q3=${formatNumber(stats.q3)} · Outliers=${stats.outliers.length}. Only outlier points are clickable — switch to Scatter to select other values.`
              : 'Not enough numeric values to compute this chart.'}
          </div>
          <div className="chart-actions">{renderBlankedToggleActions({ columns: headerColumns })}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[trace, ...comparisonTraces]}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 400,
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
            showlegend: hasComparisons,
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
        </div>
      </section>
    )
  }

  if (plotType === 'density') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    const densityPoints = computeDensityPoints(values)
    // Defensive backstop -- see the matching comment in the histogram branch above.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const hasComparisons = validComparisonColumns.length > 0
    // Each curve is computed independently over its own column's values, so each integrates to 1
    // on its own -- they aren't forced onto a shared grid, they just share the same Plotly axes.
    const comparisonDensities = validComparisonColumns.map((column, index) => {
      const columnValues = getVisibleColumnValues(sheet, column, cellState).map((entry) => entry.value)
      const columnPoints = computeDensityPoints(columnValues)
      const color = COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length]
      return {
        type: 'scatter' as const,
        mode: 'lines' as const,
        x: columnPoints.map((point) => point.x),
        y: columnPoints.map((point) => point.y),
        name: column,
        fill: 'tozeroy' as const,
        fillcolor: hexToRgba(color, 0.4),
        line: { color, width: 2 },
        hovertemplate: `${column}: %{x:.3f}<br>Density: %{y:.4f}<extra></extra>`,
      }
    })

    const headerColumns = hasComparisons ? [selectedColumn, ...validComparisonColumns] : [selectedColumn]

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">Read-only view of the estimated distribution shape (Gaussian KDE). Switch to Scatter to select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions({ columns: headerColumns })}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[
            {
              type: 'scatter',
              mode: 'lines',
              x: densityPoints.map((point) => point.x),
              y: densityPoints.map((point) => point.y),
              name: selectedColumn,
              fill: 'tozeroy',
              fillcolor: theme === 'dark' ? 'rgba(96, 165, 250, 0.25)' : 'rgba(59, 130, 246, 0.2)',
              line: { color: chartColors.histogramLine, width: 2 },
              hovertemplate: `${selectedColumn}: %{x:.3f}<br>Density: %{y:.4f}<extra></extra>`,
            },
            ...comparisonDensities,
          ]}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 400,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            showlegend: hasComparisons,
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
        </div>
      </section>
    )
  }

  if (plotType === 'cdf') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    const cdfPoints = computeCdfPoints(values)
    // Defensive backstop -- see the matching comment in the histogram branch above.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const hasComparisons = validComparisonColumns.length > 0
    const comparisonCdfs = validComparisonColumns.map((column, index) => {
      const columnValues = getVisibleColumnValues(sheet, column, cellState).map((entry) => entry.value)
      const columnPoints = computeCdfPoints(columnValues)
      const color = COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length]
      return {
        type: 'scatter' as const,
        mode: 'lines' as const,
        line: { color, width: 2, shape: 'hv' as const },
        x: columnPoints.map((point) => point.x),
        y: columnPoints.map((point) => point.y),
        name: column,
        hovertemplate: `${column}: %{x:.3f}<br>Cumulative probability: %{y:.3f}<extra></extra>`,
      }
    })

    const headerColumns = hasComparisons ? [selectedColumn, ...validComparisonColumns] : [selectedColumn]

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">Read-only view of the empirical cumulative distribution. Switch to Scatter to select values.</div>
          <div className="chart-actions">{renderBlankedToggleActions({ columns: headerColumns })}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[
            {
              type: 'scatter',
              mode: 'lines',
              line: { color: chartColors.histogramLine, width: 2, shape: 'hv' },
              x: cdfPoints.map((point) => point.x),
              y: cdfPoints.map((point) => point.y),
              name: selectedColumn,
              hovertemplate: `${selectedColumn}: %{x:.3f}<br>Cumulative probability: %{y:.3f}<extra></extra>`,
            },
            ...comparisonCdfs,
          ]}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 400,
            margin: { l: 56, r: 24, t: 24, b: 48 },
            font: { color: chartColors.text },
            showlegend: hasComparisons,
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
        </div>
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

    // Defensive backstop -- see the matching comment in the histogram branch above.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const hasComparisons = validComparisonColumns.length > 0
    // Each comparison column gets its own quantile-quantile series against the same theoretical
    // quantiles -- computed independently (its own N, its own sample quantiles), not selectable
    // (no cellId/click wiring), matching how every other chart type's comparison traces work. Only
    // one reference line is drawn (above, from the primary column) -- it is not duplicated here.
    const comparisonQqTraces = validComparisonColumns.map((column, index) => {
      const entries = getVisibleColumnValues(sheet, column, cellState)
      const columnQqEntries = computeQQPlotPoints(entries)
      const color = COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length]
      return {
        type: 'scatter' as const,
        mode: 'markers' as const,
        x: columnQqEntries.map((entry) => entry.theoretical),
        y: columnQqEntries.map((entry) => entry.sample),
        name: column,
        marker: { color, size: 7, opacity: 0.85 },
        hovertemplate: `${column}: %{y:.3f}<extra></extra>`,
      }
    })
    extraTraces.push(...comparisonQqTraces)

    return renderPointChart(points, {
      keyPrefix: 'qq',
      tip: 'Tip: click points to select. Points close to the dashed line suggest a normal distribution.',
      xAxisTitle: 'Theoretical normal quantiles',
      yAxisTitle: `Sample quantiles / value column: ${selectedColumn}`,
      extraTraces,
      showLegend: hasComparisons,
      headerColumns: hasComparisons ? [selectedColumn, ...validComparisonColumns] : [selectedColumn],
    })
  }

  // Row order and Date share an ordered X-axis; any other column -- numeric or string/categorical
  // -- has no inherent order, so a sort is only meaningful for the Date case (see below). Whether
  // a series renders with connecting lines is now entirely the "Lines" toggle's call (linesEnabled).
  const isRowOrderXAxis = xAxis === ROW_ORDER_AXIS
  const isDateXAxis = !isRowOrderXAxis && isDateCol(xAxis, sheet.rows)

  const points = sheet.rows
    .map((row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const state = cellState[cellId]
      const isBlanked = state?.valueOverride === null || state?.mark === 'blanked'
      if (isBlanked && !showBlankedPoints) {
        return null
      }
      const yValue = toNumber(isBlanked ? row[selectedColumn] : getEffectiveValue(row[selectedColumn], state))
      const xValue = isRowOrderXAxis
        ? rowIndex + 1
        : resolveAxisValue(getEffectiveValue(row[xAxis], cellState[makeCellId(sheet.name, rowIndex, xAxis)]), isDateXAxis)

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

  // Comparison overlay now applies across every X-axis mode:
  //  - Row order or a Date column: each comparison column is drawn as its own line, sharing the
  //    primary trace's X positions -- this is the time-series-over-dates use case.
  //  - Any other column, numeric or string/categorical (a genuine X-Y correlation scatter): each
  //    comparison column is drawn as its own point series against that same X column, since
  //    there's no meaningful "line order" along an arbitrary or categorical axis.
  const overlayApplies = comparisonColumns.length > 0

  const comparisonTraces = overlayApplies
    ? comparisonColumns.map((column, index) => {
        const color = COMPARISON_COLOR_PALETTE[index % COMPARISON_COLOR_PALETTE.length]
        const seriesPoints: { x: number | string; y: number }[] = []

        sheet.rows.forEach((row, rowIndex) => {
          const yCellId = makeCellId(sheet.name, rowIndex, column)
          const yState = cellState[yCellId]
          if (yState?.valueOverride === null) {
            return
          }
          const yValue = toNumber(getEffectiveValue(row[column], yState))
          if (yValue === null) {
            return
          }

          const xValue = isRowOrderXAxis
            ? rowIndex + 1
            : resolveAxisValue(getEffectiveValue(row[xAxis], cellState[makeCellId(sheet.name, rowIndex, xAxis)]), isDateXAxis)
          if (xValue === null) {
            return
          }

          seriesPoints.push({ x: xValue, y: yValue })
        })

        // Sorting only matters for a connected line -- row order is already in order, and a
        // numeric/categorical axis renders unconnected markers where order is irrelevant (and,
        // for a categorical string axis, a numeric a-b subtraction would be NaN anyway).
        if (isDateXAxis) {
          seriesPoints.sort((a, b) => (a.x as number) - (b.x as number))
        }

        // Whether these render as lines is now purely the "Lines" toggle's call, uniformly
        // across every X-axis mode -- no more auto-detecting it from row-order/date vs. other.
        // Exclusive, not additive -- see the matching comment on the primary trace above.
        return {
          type: linesEnabled ? ('scatter' as const) : ('scattergl' as const),
          mode: linesEnabled ? ('lines' as const) : ('markers' as const),
          x: seriesPoints.map((point) => point.x),
          y: seriesPoints.map((point) => point.y),
          name: column,
          line: { color, width: 2 },
          marker: { color, size: 8, opacity: 0.85 },
          hovertemplate: `${column}: %{y:.3f}<extra></extra>`,
        }
      })
    : []

  return renderPointChart(points, {
    keyPrefix: 'scatter',
    tip: 'Tip: click points to select. Drag to select many. Use the toolbar to zoom or reset.',
    xAxisTitle: `X-axis: ${xAxis === ROW_ORDER_AXIS ? 'Row order' : xAxis}`,
    yAxisTitle: `Y-axis / value column: ${selectedColumn}`,
    extraTraces: comparisonTraces,
    showLegend: overlayApplies,
    headerColumns: overlayApplies ? [selectedColumn, ...comparisonColumns] : [selectedColumn],
    xAxisType: isDateXAxis ? 'date' : undefined,
    showLinesToggle: true,
  })
}
