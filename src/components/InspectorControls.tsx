import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { PlotType } from '../types/data'
import { PLOT_TYPE_OPTIONS, ROW_ORDER_AXIS } from '../types/data'
import { findValueColumns } from '../utils/numeric'
import { COMPARISON_COLOR_PALETTE } from '../utils/chartData'

const COMPARISON_COLUMN_CAP = 4

type PanelPosition = { top: number; left: number; width: number }

export function InspectorControls() {
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    xAxis,
    plotType,
    comparisonColumns,
    setActiveSheetName,
    setSelectedColumn,
    setXAxis,
    setPlotType,
    addComparisonColumn,
    removeComparisonColumn,
    clearComparisonColumns,
  } = useDataInspectorStore()

  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const toggleRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The dropdown is portaled to document.body and positioned with fixed coordinates.
  // Rendered in place, the sidebar's own overflow-y: auto would clip it as soon as it grew
  // past the visible scroll area.
  useEffect(() => {
    if (!isCompareOpen || !toggleRef.current) {
      return
    }

    function updatePosition() {
      const rect = toggleRef.current!.getBoundingClientRect()
      setPanelPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [isCompareOpen])

  useEffect(() => {
    if (!isCompareOpen) {
      return
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node
      if (toggleRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      setIsCompareOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isCompareOpen])

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  // The X-axis accepts any column: date, numeric, or string. Plotly renders a string column as
  // categorical ticks on its own, so no special handling is needed here.
  const allColumns = sheet?.columns ?? []
  const valueColumns = findValueColumns(sheet?.rows ?? [], sheet?.columns ?? [])
  const sheetOptions = workbook?.sheets ?? []
  const compareCandidates = valueColumns.filter((column) => column !== selectedColumn && column !== xAxis)
  const isAtCap = comparisonColumns.length >= COMPARISON_COLUMN_CAP

  return (
    <section className="panel controls-panel">
      <div className="panel-title">Inspect Data</div>
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

      {plotType === 'table' ? (
        <p className="hint">All columns shown. Y-axis and X-axis don&apos;t apply to Table view.</p>
      ) : (
        <>
          <label className="field">
            <span>Y-axis</span>
            <select
              value={selectedColumn}
              onChange={(event) => setSelectedColumn(event.target.value)}
              disabled={valueColumns.length === 0}
            >
              {valueColumns.map((column) => (
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
              {allColumns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <div className="compare-columns-row">
            <span className="compare-columns-row-label">Compare:</span>
            <div className="compare-columns-dropdown" ref={toggleRef}>
              <button
                type="button"
                className="compare-columns-toggle"
                onClick={() => setIsCompareOpen((current) => !current)}
                aria-expanded={isCompareOpen}
                disabled={compareCandidates.length === 0}
                title="Overlay additional numeric columns on the chart. Chart only — does not affect cleaning, transform, or statistics tools."
              >
                {comparisonColumns.length > 0 ? `${comparisonColumns.length} columns` : 'Add columns'}
                <Icon name="chevron-down" />
              </button>
              {isCompareOpen && panelPosition
                ? createPortal(
                    <div
                      className="compare-columns-panel"
                      ref={panelRef}
                      style={{ top: panelPosition.top, left: panelPosition.left, width: panelPosition.width }}
                    >
                      <button
                        type="button"
                        className="compare-columns-clear"
                        onClick={() => clearComparisonColumns()}
                        disabled={comparisonColumns.length === 0}
                      >
                        Clear
                      </button>
                      <div className="batch-column-list">
                        {compareCandidates.map((column) => {
                          const isChecked = comparisonColumns.includes(column)
                          const isDisabledByCap = !isChecked && isAtCap
                          const swatchIndex = isChecked ? comparisonColumns.indexOf(column) : comparisonColumns.length
                          const swatchColor = COMPARISON_COLOR_PALETTE[swatchIndex % COMPARISON_COLOR_PALETTE.length]
                          return (
                            <label key={column} className="transform-checkbox-row">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isDisabledByCap}
                                onChange={() =>
                                  isChecked ? removeComparisonColumn(column) : addComparisonColumn(column)
                                }
                              />
                              <span
                                className="compare-color-swatch"
                                style={isDisabledByCap ? undefined : { backgroundColor: swatchColor, borderColor: swatchColor }}
                                aria-hidden="true"
                              />
                              {column}
                            </label>
                          )
                        })}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </div>
        </>
      )}

      <label className="field">
        <span>Plot type</span>
        <select value={plotType} onChange={(event) => setPlotType(event.target.value as PlotType)}>
          {PLOT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <p className="hint">Scatter lets you click or drag-select values. Other chart types show the selected column’s distribution.</p>

      {sheet && valueColumns.length === 0 ? (
        <p className="hint">No numeric columns were found in this sheet.</p>
      ) : null}
    </section>
  )
}
