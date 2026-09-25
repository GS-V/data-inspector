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
import { rowsToCsv, downloadBlob, downloadCsv } from '../utils/exportCsv'
import { findValueColumns, getDisplayValue, getEffectiveValue, isDateCol, isMissing, toNumber } from '../utils/numeric'
import { aggregateSeries, buildCorrelationMatrix, dunnTest, formatNumber, kruskalWallis } from '../utils/stats'

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

// Resolve a non-row-order X-axis cell into the value Plotly should plot.
// A date axis needs the epoch-millisecond number, paired with layout.xaxis.type: 'date'.
// Anything else that parses as a number stays numeric.
// Pass a genuine string value such as "V1" straight through. toNumber() returns null for it,
// which would silently drop the row and leave a string X-axis column rendering an empty chart.
// Plotly renders a string axis as categorical ticks on its own.
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

// Tooltip / table p-value text. d3-format's .4f would print "0.0000" for any p < 5e-5.
function fmtP(rawP: number, isDiag: boolean): string {
  if (isDiag || rawP === 0) return 'p = 0'
  if (Number.isNaN(rawP)) return 'n/a'
  if (rawP < 1e-4) return 'p < 1e-4'
  return `p = ${rawP.toFixed(4)}`
}

// Stars for a single already-adjusted p. The correlation heatmap keeps its own sigStars, which
// also handles the diagonal and the Bonferroni toggle.
function sigStarsSimple(p: number): string {
  if (Number.isNaN(p) || p >= 0.05) return 'n.s.'
  if (p < 0.001) return '***'
  if (p < 0.01) return '**'
  return '*'
}

// R identifier for a column name, safe for names with spaces or symbols.
function rName(column: string): string {
  return `\`${column.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
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
  // The DOM node Plotly manages for whichever chart type is rendered. Every <Plot ref={...}>
  // below forwards its ref straight to it. One ref serves every branch, because exactly one
  // <Plot> is ever mounted. Plotly.downloadImage needs this node to export the chart.
  const graphDivRef = useRef<HTMLDivElement | null>(null)

  // Plotly's autosize and useResizeHandler remeasure only on a window resize. The fallback
  // height therefore stays stale until one happens, which shows on first paint and whenever the
  // surrounding CSS grid settles for any other reason. A ResizeObserver on the plot area keeps
  // chartAreaHeight correct at once, and every chart's explicit layout.height reads it.
  // chartAreaWidth rides the same observer. Only the export popover's "Current" preset uses it.
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
    groupByColumn,
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

  // Whether to connect each scatter series with lines. This is a transient view preference,
  // not session data, so it lives in local state rather than the store. It means nothing outside
  // the scatter view, so any other plot type resets it.
  // The reset uses React's "adjust state during render" pattern, documented at
  // react.dev/learn/you-might-not-need-an-effect. Resetting inside a useEffect would instead
  // trigger a second, avoidable render.
  const [scatterLinesMode, setScatterLinesMode] = useState(false)
  // Chart export popover -- also transient view state, not session data.
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportWidth, setExportWidth] = useState('800')
  const [exportHeight, setExportHeight] = useState('500')
  const [exportFormat, setExportFormat] = useState<'png' | 'svg'>('png')
  const [exportError, setExportError] = useState<string | null>(null)
  // Correlation method -- transient view state, like the Lines toggle. Declared up here with the
  // other hooks because the component returns early below.
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman' | 'kendall'>('pearson')
  // Significance display toggles for the heatmap. View-only: they change stars and masking, never
  // the underlying r, n, or raw p (which the tooltip and Stats CSV always report).
  const [showMaskNS, setShowMaskNS] = useState(false)
  const [useBonferroni, setUseBonferroni] = useState(false)

  const [lastObservedPlotType, setLastObservedPlotType] = useState(plotType)
  if (plotType !== lastObservedPlotType) {
    setLastObservedPlotType(plotType)
    if (plotType !== 'scatter') {
      setScatterLinesMode(false)
    }
    // The export button and its popover live in the chart header, which Table never renders.
    // Close the popover on every plot-type change. Otherwise it stays open in state while
    // invisible, then silently reappears on the way back from Table.
    setIsExportOpen(false)
    setExportError(null)
  }
  // Gate on plotType as well as scatterLinesMode, as cheap defense in depth.
  // scatterLinesMode means something only while the scatter view is actually showing.
  const linesEnabled = plotType === 'scatter' && scatterLinesMode

  // Portaled to document.body and positioned with fixed coordinates, for the same reason as the
  // sidebar's "Compare columns" dropdown. Rendered in place, .chart-panel's own overflow: hidden
  // would clip it as soon as it grew past the panel edge.
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

  // Defer the potentially heavy chart computation below by one tick whenever the user picks a
  // different sheet, column, axis, or plot type. A brief "Rendering chart..." state then paints
  // before the main thread blocks.
  // The key deliberately omits cellState. A mark, blank, or transform elsewhere therefore
  // updates this chart in place, with no spinner. Such an edit is ordinary reactive
  // re-rendering, not a new computation the user asked for.
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

  // Correlation heatmap — read-only, no cell selection.
  // graphDivRef is shared so chart export works without extra wiring.
  // corrMethod is local state; switching method does not affect
  // cellState, auditLog, or any other store slice.
  if (plotType === 'correlation') {
    // Defensive backstop -- see the matching comment in the histogram branch below.
    const validComparisonColumns = comparisonColumns.filter((column) => !isDateCol(column, sheet.rows))
    const corrColumns = [selectedColumn, ...validComparisonColumns]

    if (corrColumns.length < 2) {
      return (
        <section className="panel chart-panel">
          {renderChartHeader(corrColumns)}
          <div className="chart-empty-state">
            Select at least one comparison column to show a correlation matrix.
          </div>
        </section>
      )
    }

    // Values stay aligned by row index so each pair of columns is compared row by row.
    // getVisibleColumnValues drops rows, so it cannot be used here. The overlay rule is the
    // same: a blanked cell (valueOverride: null) or a non-numeric value becomes null.
    const columnValues = corrColumns.map((name) => ({
      name,
      values: sheet.rows.map((row, rowIndex) => {
        const state = cellState[makeCellId(sheet.name, rowIndex, name)]
        if (state?.valueOverride === null) {
          return null
        }
        return toNumber(getEffectiveValue(row[name], state))
      }),
    }))
    // Kendall is O(n²) per column pair and can freeze the page on large sheets. The largest
    // non-null count is an upper bound on any pair's paired rows.
    const maxPairedRows = Math.max(0, ...columnValues.map((c) => c.values.filter((v) => v != null).length))
    const kendallDisabled = maxPairedRows > 3000
    // Derived during render rather than reset in an effect: an effect runs after render, so the
    // expensive Kendall matrix would already have been computed once. corrMethod keeps 'kendall',
    // so a smaller sheet switches back to it on its own.
    const activeCorrMethod = kendallDisabled && corrMethod === 'kendall' ? 'spearman' : corrMethod
    const { labels, matrix, statsMatrix } = buildCorrelationMatrix(columnValues, activeCorrMethod)
    const methodLabel =
      activeCorrMethod === 'pearson' ? 'Pearson r' : activeCorrMethod === 'spearman' ? 'Spearman ρ' : 'Kendall τ-b'

    // Bonferroni applies only to stars and the n.s. mask. Raw p is always what the tooltip and
    // the Stats CSV report.
    const numUniquePairs = (labels.length * (labels.length - 1)) / 2
    const effectiveP = (rawP: number): number => (useBonferroni ? Math.min(rawP * numUniquePairs, 1.0) : rawP)

    function sigStars(rawP: number, isDiag: boolean): string {
      if (isDiag || Number.isNaN(rawP)) return ''
      const p = effectiveP(rawP)
      if (p < 0.001) return '***'
      if (p < 0.01) return '**'
      if (p < 0.05) return '*'
      return ''
    }

    const isMasked = (i: number, j: number) =>
      showMaskNS && i !== j && !Number.isNaN(statsMatrix[i][j].r) && !(effectiveP(statsMatrix[i][j].p) < 0.05)
    const cellText = statsMatrix.map((row, i) =>
      row.map((cell, j) => {
        if (Number.isNaN(cell.r)) return 'N/A'
        if (isMasked(i, j)) return ''
        return `${cell.r.toFixed(2)}${sigStars(cell.p, i === j)}`
      }),
    )
    // Parallel to z. Slot [2] is always the RAW numeric p -- see effectiveP above; slot [6] is
    // its display string.
    const customData = statsMatrix.map((row, i) =>
      row.map((cell, j) => [
        cell.r,
        cell.n,
        cell.p,
        cell.ciLow,
        cell.ciHigh,
        i === j ? 1 : 0,
        fmtP(cell.p, i === j),
      ]),
    )
    // NaN (too few paired values) and masked n.s. cells become null, which Plotly draws as a gap.
    const zValues = matrix.map((row, i) =>
      row.map((value, j) => {
        if (Number.isNaN(value) || isMasked(i, j)) return null
        return value
      }),
    )

    const hasCorrCI = activeCorrMethod !== 'kendall'
    const corrHoverTemplate = [
      '%{y} × %{x}',
      `${methodLabel}: %{customdata[0]:.4f}`,
      'n pairs: %{customdata[1]}',
      '%{customdata[6]} (raw)',
      hasCorrCI ? '95% CI: [%{customdata[3]:.3f}, %{customdata[4]:.3f}]' : null,
      useBonferroni ? `Bonferroni active — stars and mask use p × ${numUniquePairs}` : null,
      '<extra></extra>',
    ]
      .filter(Boolean)
      .join('<br>')

    function downloadStatsCsv() {
      const orNull = (v: number) => (Number.isNaN(v) ? null : v)
      const rows: Record<string, string | number | null>[] = []
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const c = statsMatrix[i][j]
          rows.push({
            col_A: labels[i],
            col_B: labels[j],
            method: activeCorrMethod,
            r: orNull(c.r),
            n: c.n,
            p: orNull(c.p),
            ci_low: orNull(c.ciLow),
            ci_high: orNull(c.ciHigh),
          })
        }
      }
      // rowsToCsv quotes any column name containing a comma, quote, or newline.
      const csv = rowsToCsv(rows, ['col_A', 'col_B', 'method', 'r', 'n', 'p', 'ci_low', 'ci_high'])
      downloadCsv(`correlation-stats-${activeCorrMethod}.csv`, csv)
    }

    return (
      <section className="panel chart-panel">
        {renderChartHeader(corrColumns)}
        <div className="chart-toolbar">
          <div className="corr-method-bar">
            <button
              type="button"
              className={activeCorrMethod === 'pearson' ? 'code-lang-active' : undefined}
              onClick={() => setCorrMethod('pearson')}
            >
              Pearson
            </button>
            <button
              type="button"
              className={activeCorrMethod === 'spearman' ? 'code-lang-active' : undefined}
              onClick={() => setCorrMethod('spearman')}
            >
              Spearman
            </button>
            <button
              type="button"
              className={activeCorrMethod === 'kendall' ? 'code-lang-active' : undefined}
              onClick={() => setCorrMethod('kendall')}
              disabled={kendallDisabled}
              title={
                kendallDisabled
                  ? `Kendall is disabled above 3 000 paired rows (this sheet has ${maxPairedRows}). Use Spearman instead.`
                  : undefined
              }
            >
              Kendall
            </button>
            <span className="corr-divider" aria-hidden="true" />
            <button
              type="button"
              className={showMaskNS ? 'code-lang-active' : undefined}
              aria-pressed={showMaskNS}
              onClick={() => setShowMaskNS((v) => !v)}
              title="Hide cells where effective p >= 0.05. Stars: * p<0.05  ** p<0.01  *** p<0.001"
            >
              Mask n.s.
            </button>
            <span className="corr-divider" aria-hidden="true" />
            <button
              type="button"
              className={useBonferroni ? 'code-lang-active' : undefined}
              aria-pressed={useBonferroni}
              onClick={() => setUseBonferroni((v) => !v)}
              title="Bonferroni correction: multiply each p-value by the number of unique pairs before thresholding. Reduces false positives when comparing many columns simultaneously."
            >
              Bonferroni
            </button>
          </div>
          <div className="chart-actions">
            <button type="button" className="corr-stats-csv-btn" onClick={downloadStatsCsv}>
              ↓ Stats CSV
            </button>
            {renderExportControl(corrColumns)}
          </div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[
            {
              type: 'heatmap' as const,
              x: labels,
              y: labels,
              z: zValues,
              zmin: -1,
              zmax: 1,
              colorscale: [
                [0, '#e8736b'],
                [0.5, '#ffffff'],
                [1, '#7fa3d6'],
              ],
              text: cellText,
              texttemplate: '%{text}',
              textfont: { color: '#222222' },
              customdata: customData,
              hovertemplate: corrHoverTemplate,
              showscale: true,
              colorbar: { thickness: 14, len: 0.8 },
            },
          ]}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 400,
            margin: { t: 20, r: 80, b: 100, l: 100 },
            font: { color: chartColors.text, size: 11 },
            xaxis: { side: 'bottom', tickangle: -35, automargin: true },
            yaxis: { autorange: 'reversed' as const, automargin: true },
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
          }}
          config={{ displaylogo: false, displayModeBar: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
        </div>
      </section>
    )
  }

  // Completeness view -- read-only, no cell selection.
  // Reads RAW sheet values (not cellState), so it shows the gaps in the original file rather
  // than cells the user blanked during QC.
  // Both sections live in ONE Plotly figure (two subplots) rather than two <Plot>s: graphDivRef
  // and the chart-area ResizeObserver both assume exactly one mounted <Plot>, and a single figure
  // keeps chart export capturing the whole view.
  if (plotType === 'completeness') {
    const valueColumns = findValueColumns(sheet.rows, sheet.columns)
    const corrColumns = [selectedColumn, ...comparisonColumns].filter((column) => valueColumns.includes(column))
    const totalRows = sheet.rows.length
    const showGrid = corrColumns.length >= 2

    const missingCounts = corrColumns.map(
      (column) => sheet.rows.filter((row) => isMissing(row[column])).length,
    )
    const missingPct = missingCounts.map((count) => (totalRows > 0 ? (count / totalRows) * 100 : 0))
    const barColors = missingPct.map((pct) => (pct <= 5 ? chartColors.histogram : pct <= 20 ? '#fb8500' : '#e63946'))

    // Row labels: the file's identifier column if the parser found one, otherwise the first
    // non-numeric column, otherwise the 1-based row number (matching "Row N" elsewhere).
    // Plotly merges duplicate category labels into one row, so a non-unique label column gets
    // the row number appended.
    const labelColumn = sheet.identifierColumns[0] ?? sheet.columns.find((column) => !valueColumns.includes(column))
    const shownRows = totalRows > 200 ? sheet.rows.slice(0, 200) : sheet.rows
    const rawLabels = shownRows.map((row, rowIndex) =>
      labelColumn && !isMissing(row[labelColumn]) ? getDisplayValue(row[labelColumn]) : String(rowIndex + 1),
    )
    const labelsUnique = new Set(rawLabels).size === rawLabels.length
    const rowLabels = labelsUnique ? rawLabels : rawLabels.map((label, rowIndex) => `${label} · row ${rowIndex + 1}`)

    const presence = shownRows.map((row) => corrColumns.map((column) => (isMissing(row[column]) ? 0 : 1)))
    const presenceText = presence.map((row) => row.map((value) => (value ? 'present' : 'missing')))

    const plotHeight = chartAreaHeight ?? 400
    const barHeightPx = showGrid ? Math.max(150, plotHeight * 0.3) : plotHeight
    // Fractions of the figure: the bar block on top, a gap for the note and the grid title, then
    // the grid filling the rest.
    const notes: string[] = []
    if (totalRows > 200 && showGrid) {
      notes.push(`Showing first 200 of ${totalRows} rows — column counts above use all rows`)
    }
    if (!showGrid) {
      notes.push('Add a comparison column to see the row-level presence grid.')
    }
    // Pixel budget between the two subplots: ~64px for the bar axis ticks and "% missing" title,
    // 18px per note line, then ~52px for the grid title above its top-side column labels.
    const px = (value: number) => value / plotHeight
    const barDomainStart = showGrid ? 1 - barHeightPx / plotHeight : 0
    const gridDomainEnd = Math.max(0.05, barDomainStart - px(64 + notes.length * 18 + 52))

    const titleAnnotation = (text: string, y: number) => ({
      text: `<b>${text}</b>`,
      xref: 'paper' as const,
      yref: 'paper' as const,
      x: 0,
      y,
      xanchor: 'left' as const,
      yanchor: 'bottom' as const,
      showarrow: false,
      font: { size: 12, color: chartColors.text },
    })

    return (
      <section className="panel chart-panel">
        {renderChartHeader(corrColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">
            Missing = blank in the original file. Cells blanked during cleaning are not counted.
          </div>
          <div className="chart-actions">{renderExportControl(corrColumns)}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={[
            {
              type: 'bar' as const,
              orientation: 'h' as const,
              x: missingPct,
              y: corrColumns,
              xaxis: 'x',
              yaxis: 'y',
              marker: { color: barColors },
              text: missingCounts.map((count) => `${count} / ${totalRows} missing`),
              textposition: 'outside' as const,
              cliponaxis: false,
              hovertemplate: '%{y}: %{x:.1f}% missing (%{text})<extra></extra>',
            },
            ...(showGrid
              ? [
                  {
                    type: 'heatmap' as const,
                    x: corrColumns,
                    y: rowLabels,
                    z: presence,
                    zmin: 0,
                    zmax: 1,
                    xaxis: 'x2',
                    yaxis: 'y2',
                    colorscale: [
                      [0, '#e63946'],
                      [1, '#4575b4'],
                    ],
                    customdata: presenceText,
                    hovertemplate: '%{y}<br>%{x}<br>%{customdata}<extra></extra>',
                    showscale: false,
                    xgap: 1,
                    ygap: shownRows.length <= 60 ? 1 : 0,
                  },
                ]
              : []),
          ]}
          layout={{
            autosize: true,
            height: plotHeight,
            // Primary-only view puts its note below the plot, so it needs a taller bottom margin.
            margin: { t: 28, r: 90, b: showGrid ? 40 : 100, l: 100 },
            font: { color: chartColors.text, size: 11 },
            showlegend: false,
            xaxis: {
              title: { text: '% missing' },
              range: [0, 100],
              anchor: 'y',
              gridcolor: chartColors.grid,
              zeroline: false,
            },
            yaxis: {
              domain: [barDomainStart, 1],
              autorange: 'reversed' as const,
              automargin: true,
            },
            xaxis2: { anchor: 'y2', side: 'top', automargin: true },
            yaxis2: {
              domain: [0, gridDomainEnd],
              type: 'category' as const,
              autorange: 'reversed' as const,
              automargin: true,
            },
            annotations: [
              titleAnnotation('Missing values per column', 1),
              ...(showGrid ? [titleAnnotation('Row-level presence / absence', gridDomainEnd + px(30))] : []),
              ...notes.map((text, index) => ({
                text,
                xref: 'paper' as const,
                yref: 'paper' as const,
                x: 0,
                y: showGrid ? barDomainStart - px(64 + index * 18) : -px(64 + index * 18),
                xanchor: 'left' as const,
                yanchor: 'top' as const,
                showarrow: false,
                font: { size: 11, color: chartColors.text },
              })),
            ],
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
          }}
          config={{ displaylogo: false, displayModeBar: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
        </div>
      </section>
    )
  }

  // Group comparison -- read-only. Uses CLEANED values (blanked cells excluded, replacements and
  // transforms applied), like every chart except Completeness.
  if (plotType === 'group-comparison') {
    const effectiveGroupBy = groupByColumn && groupByColumn !== selectedColumn && sheet.columns.includes(groupByColumn)
      ? groupByColumn
      : null

    if (!effectiveGroupBy) {
      return (
        <section className="panel chart-panel">
          {renderChartHeader([selectedColumn])}
          <div className="chart-empty-state">Select a &quot;Group by&quot; column in the sidebar to compare groups.</div>
        </section>
      )
    }

    const groupMap = new Map<string, number[]>()
    sheet.rows.forEach((row, rowIndex) => {
      const gVal = row[effectiveGroupBy]
      if (isMissing(gVal)) return
      const state = cellState[makeCellId(sheet.name, rowIndex, selectedColumn)]
      if (state?.valueOverride === null) return
      const yVal = toNumber(getEffectiveValue(row[selectedColumn], state))
      if (yVal === null) return
      const label = getDisplayValue(gVal)
      const values = groupMap.get(label)
      if (values) values.push(yVal)
      else groupMap.set(label, [yVal])
    })

    // Natural order, so numeric-looking groups sort 1, 2, 10 rather than 1, 10, 2.
    const groupLabels = [...groupMap.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const groups = groupLabels.map((label) => groupMap.get(label)!)
    const totalN = groups.reduce((sum, g) => sum + g.length, 0)

    const kw = kruskalWallis(groups)
    const dunn = groupLabels.length >= 3 && !Number.isNaN(kw.H) ? dunnTest(groups, groupLabels) : null
    // Every point is drawn (jittered) up to this size; above it, only outliers.
    const showAllPoints = totalN <= 5000

    const boxTraces = groupLabels.map((label, gi) => {
      const color = COMPARISON_COLOR_PALETTE[gi % COMPARISON_COLOR_PALETTE.length]
      return {
        type: 'box' as const,
        name: label,
        y: groupMap.get(label)!,
        boxmean: true as const,
        boxpoints: showAllPoints ? ('all' as const) : ('outliers' as const),
        jitter: 0.3,
        pointpos: 0,
        marker: { color, opacity: 0.6, size: 4 },
        line: { color },
        hovertemplate: `${label}<br>${selectedColumn}: %{y:.3f}<extra></extra>`,
      }
    })

    function downloadRScript() {
      const y = rName(selectedColumn)
      const g = rName(effectiveGroupBy!)
      const title = `Group Comparison: ${selectedColumn} by ${effectiveGroupBy}`.replace(/"/g, '\\"')
      const lines = [
        '# Data Inspector — Group Comparison Export',
        `# Response: ${selectedColumn}  |  Group: ${effectiveGroupBy}`,
        `# Generated: ${new Date().toISOString().split('T')[0]}`,
        '#',
        '# The app ran these tests on the CLEANED values. To match its numbers, point read.csv at',
        '# the cleaned CSV from "Export data" rather than the original file.',
        '',
        'df <- read.csv("your_file.csv", check.names = FALSE)',
        `df[[${JSON.stringify(effectiveGroupBy)}]] <- factor(df[[${JSON.stringify(effectiveGroupBy)}]])`,
        '',
        '# Kruskal-Wallis test',
        `kruskal.test(${y} ~ ${g}, data = df)`,
        '',
        "# Dunn's pairwise test, Bonferroni-adjusted (same test as the app's table)",
        '# install.packages("FSA")',
        `FSA::dunnTest(${y} ~ ${g}, data = df, method = "bonferroni")`,
        '',
        '# Visualize',
        'library(ggplot2)',
        `ggplot(df, aes(x = ${g}, y = ${y}, fill = ${g})) +`,
        '  geom_boxplot(outlier.shape = NA) +',
        '  geom_jitter(width = 0.2, alpha = 0.5) +',
        `  labs(title = "${title}") +`,
        '  theme_minimal()',
        '',
      ]
      // Plain text, no byte-order mark: downloadCsv adds one for Excel, and R's parser would see
      // it as a stray character on line 1.
      downloadBlob(
        `group-comparison-${selectedColumn}-by-${effectiveGroupBy}.R`.replace(/[\\/:*?"<>|\s]+/g, '_'),
        new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
      )
    }

    const kwLine = Number.isNaN(kw.H)
      ? 'Not enough data (need ≥ 2 groups, more observations than groups, and some variation)'
      : `H(${kw.df}) = ${kw.H.toFixed(3)},  ${fmtP(kw.p, false)}  ${sigStarsSimple(kw.p)}`

    return (
      <section className="panel chart-panel">
        {renderChartHeader([selectedColumn, effectiveGroupBy])}
        <div className="chart-toolbar">
          <div className="chart-tip">{`n = ${totalN} across ${groupLabels.length} group${groupLabels.length !== 1 ? 's' : ''}`}</div>
          <div className="chart-actions">
            <button type="button" className="corr-stats-csv-btn" onClick={downloadRScript}>
              Export R script
            </button>
            {renderExportControl([selectedColumn, effectiveGroupBy])}
          </div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={boxTraces}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 350,
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            font: { color: chartColors.text },
            showlegend: false,
            margin: { t: 20, r: 16, b: 60, l: 60 },
            // Category axis: numeric-looking groups (DAS 14, 28, ...) stay evenly spaced in the
            // sorted order above instead of being placed on a numeric scale.
            xaxis: {
              title: { text: effectiveGroupBy },
              type: 'category' as const,
              gridcolor: chartColors.grid,
              zeroline: false,
              automargin: true,
            },
            yaxis: { title: { text: selectedColumn }, gridcolor: chartColors.grid, zeroline: false, automargin: true },
          }}
          config={{ displaylogo: false, displayModeBar: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
        </div>
        <div className="group-stats-panel">
          <div className="group-kw-result">
            <span className="group-kw-label">Kruskal-Wallis</span>
            <span>{kwLine}</span>
          </div>
          {dunn && dunn.length > 0 && (
            <details className="group-dunn-details">
              <summary>Dunn&apos;s pairwise test (Bonferroni-adjusted p)</summary>
              <table className="group-dunn-table">
                <thead>
                  <tr>
                    <th>Group A</th>
                    <th>Group B</th>
                    <th>z</th>
                    <th>p (adj)</th>
                    <th aria-label="Significance" />
                  </tr>
                </thead>
                <tbody>
                  {dunn.map((row) => (
                    <tr key={`${row.groupA}\u0000${row.groupB}`}>
                      <td>{row.groupA}</td>
                      <td>{row.groupB}</td>
                      <td>{Number.isNaN(row.z) ? 'n/a' : row.z.toFixed(2)}</td>
                      <td>{fmtP(row.pAdj, false)}</td>
                      <td>{sigStarsSimple(row.pAdj)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </section>
    )
  }

  // Time series -- read-only. Cleaned Y values against the X-axis column (or row order); repeated
  // X values collapse to mean ± SE, per group when a "Group by" column is set.
  if (plotType === 'timeseries') {
    const isRowOrder = xAxis === ROW_ORDER_AXIS
    const isDateX = !isRowOrder && isDateCol(xAxis, sheet.rows)
    const effectiveGroupBy = groupByColumn && groupByColumn !== selectedColumn && sheet.columns.includes(groupByColumn)
      ? groupByColumn
      : null
    const xLabel = isRowOrder ? 'Row' : xAxis
    const NO_GROUP = '(no group)'

    const seriesRows = new Map<string, { x: number | string; y: number }[]>()
    sheet.rows.forEach((row, rowIndex) => {
      const state = cellState[makeCellId(sheet.name, rowIndex, selectedColumn)]
      if (state?.valueOverride === null) return
      const y = toNumber(getEffectiveValue(row[selectedColumn], state))
      if (y === null) return
      // Same resolution as the Scatter view: a Date column becomes epoch ms on a date axis.
      const x = isRowOrder
        ? rowIndex + 1
        : resolveAxisValue(getEffectiveValue(row[xAxis], cellState[makeCellId(sheet.name, rowIndex, xAxis)]), isDateX)
      if (x === null) return
      const group = effectiveGroupBy
        ? isMissing(row[effectiveGroupBy]) ? NO_GROUP : getDisplayValue(row[effectiveGroupBy])
        : selectedColumn
      const list = seriesRows.get(group)
      if (list) list.push({ x, y })
      else seriesRows.set(group, [{ x, y }])
    })

    const seriesLabels = [...seriesRows.keys()].sort((a, b) =>
      a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, undefined, { numeric: true }),
    )
    const traces = seriesLabels.map((label, gi) => {
      const pts = aggregateSeries(seriesRows.get(label)!)
      const hasMultiple = pts.some((p) => p.n > 1)
      const color = COMPARISON_COLOR_PALETTE[gi % COMPARISON_COLOR_PALETTE.length]
      const prefix = effectiveGroupBy ? `${label}<br>` : ''
      const xFmt = isDateX ? '%{x|%Y-%m-%d}' : '%{x}'
      return {
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: label,
        x: pts.map((p) => p.x),
        y: pts.map((p) => p.mean),
        error_y: { type: 'data' as const, array: pts.map((p) => p.se), visible: hasMultiple, color },
        line: { color },
        marker: { color, size: 6 },
        // [n, SE]: Plotly has no hover field for error_y values.
        customdata: pts.map((p) => [p.n, p.se]),
        hovertemplate: hasMultiple
          ? `${prefix}${xLabel}: ${xFmt}<br>Mean: %{y:.3f} ± %{customdata[1]:.3f} SE<br>n: %{customdata[0]}<extra></extra>`
          : `${prefix}${xLabel}: ${xFmt}<br>${selectedColumn}: %{y:.3f}<extra></extra>`,
      }
    })

    const headerColumns = effectiveGroupBy ? [selectedColumn, effectiveGroupBy] : [selectedColumn]

    return (
      <section className="panel chart-panel">
        {renderChartHeader(headerColumns)}
        <div className="chart-toolbar">
          <div className="chart-tip">
            {traces.length === 0
              ? 'No rows have both a numeric value and an X value.'
              : 'Repeated X values are averaged; error bars show ± 1 SE.'}
          </div>
          <div className="chart-actions">{renderExportControl(headerColumns)}</div>
        </div>
        <div className="chart-plot-area" ref={chartAreaRef}>
        <Plot
          ref={graphDivRef}
          data={traces}
          layout={{
            autosize: true,
            height: chartAreaHeight ?? 350,
            paper_bgcolor: chartColors.paper,
            plot_bgcolor: chartColors.plot,
            font: { color: chartColors.text },
            showlegend: Boolean(effectiveGroupBy),
            legend: { font: { color: chartColors.text } },
            margin: { t: 20, r: 16, b: 60, l: 60 },
            xaxis: {
              title: { text: xLabel },
              type: isDateX ? ('date' as const) : undefined,
              gridcolor: chartColors.grid,
              zeroline: false,
              automargin: true,
            },
            yaxis: { title: { text: selectedColumn }, gridcolor: chartColors.grid, zeroline: false, automargin: true },
          }}
          config={{ displaylogo: false, displayModeBar: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
        </div>
      </section>
    )
  }

  if (plotType === 'histogram') {
    const values = getVisibleColumnValues(sheet, selectedColumn, cellState).map((entry) => entry.value)
    // The comparison picker already excludes date columns, and the store's addComparisonColumn
    // rejects them as well. This filter is a defensive backstop only. It keeps a date column
    // from ever reaching the trace builder.
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
    // Each curve is computed over its own column's values alone, so each integrates to 1 by
    // itself. The curves share only the Plotly axes, never a common grid.
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
    // quantiles, computed from its own N and its own sample quantiles. These series carry no
    // cellId and no click wiring, so they are not selectable. Every other chart type's
    // comparison traces behave the same way.
    // The single reference line comes from the primary column above. Do not duplicate it here.
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

  // Row order and a Date column both give an ordered X-axis. Any other column, numeric or
  // string, has no inherent order, so only the Date case makes a sort meaningful. See below.
  // The "Lines" toggle alone decides whether a series renders connecting lines.
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

  // The comparison overlay applies across every X-axis mode:
  //  - Row order or a Date column: draw each comparison column as its own line, sharing the
  //    primary trace's X positions. This covers the time-series-over-dates case.
  //  - Any other column, numeric or string: draw each comparison column as its own point series
  //    against that same X column. This is a genuine X-Y correlation scatter, and an arbitrary
  //    or categorical axis carries no meaningful line order.
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

        // Only a connected line needs sorted points. Row order already arrives sorted, and a
        // numeric or categorical axis renders unconnected markers where order does not matter.
        // A categorical string axis would also make the a-b subtraction below return NaN.
        if (isDateXAxis) {
          seriesPoints.sort((a, b) => (a.x as number) - (b.x as number))
        }

        // The "Lines" toggle alone decides whether these render as lines, the same way in every
        // X-axis mode. Never infer it from the axis kind.
        // The mode is exclusive, not additive. See the matching comment on the primary trace.
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
