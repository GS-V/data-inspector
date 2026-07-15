import { useMemo, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { PreviewCell, RawCellValue } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { getDisplayValue, getEffectiveValue, toNumber } from '../utils/numeric'
import { duplicateValueKeys, percentileBounds } from '../utils/reviewChecks'
import { formatNumber, summarizeColumn } from '../utils/stats'

export function InspectionTools() {
  const {
    workbook,
    activeSheetName,
    selectedColumn,
    selectedCells,
    previewCells,
    cellState,
    setPreviewCells,
    setPlotType,
    plotType,
    markTargets,
    clearTargetMarks,
    clearPreview,
    clearSelection,
  } = useDataInspectorStore()
  const [threshold, setThreshold] = useState('')
  const [valueFilterMode, setValueFilterMode] = useState<'greater' | 'less' | 'range' | 'percentile'>('greater')
  const [rangeMatchMode, setRangeMatchMode] = useState<'inside' | 'outside'>('outside')
  const [rangeMin, setRangeMin] = useState('')
  const [rangeMax, setRangeMax] = useState('')
  const [lowerPercentile, setLowerPercentile] = useState('1')
  const [upperPercentile, setUpperPercentile] = useState('99')
  const [zCutoff, setZCutoff] = useState('3')
  const [customColor, setCustomColor] = useState('#a855f7')
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const summary = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return null
    }
    return summarizeColumn(sheet.rows, sheet.name, selectedColumn, cellState)
  }, [cellState, selectedColumn, sheet])

  function buildPreview(
    previewKey: string,
    method: string,
    predicate: (
      value: number | null,
      effectiveValue: RawCellValue,
      rawValue: RawCellValue,
      rowIndex: number,
    ) => string | null,
  ) {
    if (!sheet || !selectedColumn) {
      return
    }

    if (activePreviewKey === previewKey && Object.keys(previewCells).length > 0) {
      clearPreview()
      setActivePreviewKey(null)
      setMessage(`${method} preview cleared.`)
      return
    }

    const nextPreviewCells: PreviewCell[] = []
    sheet.rows.forEach((row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const rawValue = row[selectedColumn]
      const effectiveValue = getEffectiveValue(rawValue, cellState[cellId])
      const numericValue = toNumber(effectiveValue)
      const reason = predicate(numericValue, effectiveValue, rawValue, rowIndex)
      if (!reason) {
        return
      }

      nextPreviewCells.push({
        cellId,
        sheetName: sheet.name,
        rowIndex,
        columnName: selectedColumn,
        value: effectiveValue,
        method,
        reason,
      })
    })

    clearSelection()
    setPreviewCells(nextPreviewCells)
    setActivePreviewKey(nextPreviewCells.length > 0 ? previewKey : null)
    setMessage(`${nextPreviewCells.length.toLocaleString()} value${nextPreviewCells.length === 1 ? '' : 's'} previewed. Click the same preview again to clear it.`)
  }

  function parseInput(value: string): number | null {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  function showDistribution() {
    if (!summary) {
      setMessage('Open a sheet with a numeric column to see the distribution.')
      return
    }

    const nextPlotType = plotType === 'histogram' ? 'scatter' : 'histogram'
    setPlotType(nextPlotType)
    setMessage(
      nextPlotType === 'histogram'
        ? 'Distribution view shown. This does not select, mark, or edit values.'
        : 'Scatter view shown. You can click or drag-select points again.',
    )
  }

  function previewThreshold() {
    if (valueFilterMode === 'percentile') {
      if (!sheet || !selectedColumn) {
        return
      }

      const lower = parseInput(lowerPercentile)
      const upper = parseInput(upperPercentile)
      if (lower === null || upper === null) {
        setMessage('Enter valid lower and upper percentiles.')
        return
      }

      const values = sheet.rows
        .map((row, rowIndex) => {
          const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
          return toNumber(getEffectiveValue(row[selectedColumn], cellState[cellId]))
        })
        .filter((value): value is number => value !== null)

      const bounds = percentileBounds(values, lower, upper)
      if (!bounds) {
        setMessage('Use percentiles from 0 to 100, with the lower value below the upper value.')
        return
      }

      buildPreview(`value-filter:percentile:${lower}:${upper}`, 'Value filter', (value) => {
        if (value === null) {
          return null
        }

        return value < bounds.lowerValue || value > bounds.upperValue
          ? `Extreme value suggested for review: outside P${lower}=${formatNumber(bounds.lowerValue)} to P${upper}=${formatNumber(bounds.upperValue)}`
          : null
      })
      return
    }

    if (valueFilterMode === 'range') {
      const minimum = parseInput(rangeMin)
      const maximum = parseInput(rangeMax)
      if (minimum === null || maximum === null) {
        setMessage('Enter a valid minimum and maximum.')
        return
      }

      if (minimum >= maximum) {
        setMessage('Enter a minimum that is less than the maximum.')
        return
      }

      buildPreview(`value-filter:range:${rangeMatchMode}:${minimum}:${maximum}`, 'Value filter', (value) => {
        if (value === null) {
          return null
        }

        const isInsideRange = value >= minimum && value <= maximum
        const matches = rangeMatchMode === 'inside' ? isInsideRange : !isInsideRange

        if (!matches) {
          return null
        }

        return rangeMatchMode === 'inside'
          ? `Value ${formatNumber(value)} is inside ${minimum} to ${maximum}`
          : `Value ${formatNumber(value)} is outside ${minimum} to ${maximum}`
      })
      return
    }

    const thresholdValue = parseInput(threshold)
    if (thresholdValue === null) {
      setMessage('Enter a valid value first.')
      return
    }

    buildPreview(`value-filter:${valueFilterMode}:${thresholdValue}`, 'Value filter', (value) => {
      if (value === null) {
        return null
      }
      const matches =
        valueFilterMode === 'greater' ? value > thresholdValue : value < thresholdValue
      if (!matches) {
        return null
      }
      return `Value ${formatNumber(value)} is ${valueFilterMode === 'greater' ? 'greater than' : 'less than'} ${thresholdValue}`
    })
  }

  function showUnusualValues() {
    if (!summary || summary.q1 === null || summary.q3 === null || summary.iqr === null) {
      setMessage('There are not enough numeric values for this preview.')
      return
    }

    const lowerFence = summary.q1 - 1.5 * summary.iqr
    const upperFence = summary.q3 + 1.5 * summary.iqr

    buildPreview('outside-typical-range', 'Outside typical range', (value) =>
      value !== null && (value < lowerFence || value > upperFence)
        ? `Outside IQR fence: lower=${formatNumber(lowerFence)}, upper=${formatNumber(upperFence)}`
        : null,
    )
  }

  function showZScoreOutliers() {
    const cutoff = parseInput(zCutoff)
    if (!summary || summary.mean === null || summary.standardDeviation === null || summary.standardDeviation === 0 || cutoff === null) {
      setMessage('There are not enough numeric values for this preview.')
      return
    }

    buildPreview(`far-from-average:${cutoff}`, 'Far from average', (value) => {
      if (value === null || summary.mean === null || summary.standardDeviation === null) {
        return null
      }
      const zScore = Math.abs((value - summary.mean) / summary.standardDeviation)
      return zScore >= cutoff ? `z-score=${formatNumber(zScore, 2)}, cutoff=${cutoff}` : null
    })
  }

  function showDuplicateValues() {
    if (!sheet || !selectedColumn) {
      return
    }

    const duplicateKeys = duplicateValueKeys(
      sheet.rows.map((row, rowIndex) => {
        const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
        return getEffectiveValue(row[selectedColumn], cellState[cellId])
      }),
    )

    if (duplicateKeys.size === 0 && activePreviewKey !== 'duplicate-values') {
      setPreviewCells([])
      setActivePreviewKey(null)
      setMessage('No repeated non-empty values found in this column.')
      return
    }

    buildPreview('duplicate-values', 'Duplicate values', (_value, effectiveValue) => {
      const key = getDisplayValue(effectiveValue).trim()
      return key && duplicateKeys.has(key)
        ? `Repeated value suggested for review: ${key}`
        : null
    })
  }

  const targetCount = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)]).size
  const distributionLabel = plotType === 'histogram' ? 'Show scatter' : 'Show distribution'
  const valueFilterButtonLabel =
    valueFilterMode === 'greater'
      ? 'Preview greater than value'
      : valueFilterMode === 'less'
        ? 'Preview less than value'
        : valueFilterMode === 'range'
          ? rangeMatchMode === 'inside'
            ? 'Preview inside range'
            : 'Preview outside range'
          : 'Preview outside percentile range'

  return (
    <details className="panel tools-panel collapsible-panel review-panel" open>
      <summary className="panel-summary">Find & Review Values</summary>
      <div className="panel-body">
        <div className="inline-help-row">
          <InfoTip label="Preview finds possible values to inspect. It does not change your data." />
        </div>
        <p className="hint tool-intro">Preview suggestions, select values, then apply a highlight.</p>
        <div className="summary-grid">
        <span>Count</span>
        <strong>{summary?.count.toLocaleString() ?? '-'}</strong>
        <span>Missing</span>
        <strong>{summary?.missingCount.toLocaleString() ?? '-'}</strong>
        <span>Mean</span>
        <strong>{formatNumber(summary?.mean ?? null)}</strong>
        <span>Median</span>
        <strong>{formatNumber(summary?.median ?? null)}</strong>
        <span>Min</span>
        <strong>{formatNumber(summary?.min ?? null)}</strong>
        <span>Q1</span>
        <strong>{formatNumber(summary?.q1 ?? null)}</strong>
        <span>Q3</span>
        <strong>{formatNumber(summary?.q3 ?? null)}</strong>
        <span>Max</span>
        <strong>{formatNumber(summary?.max ?? null)}</strong>
        <span>IQR</span>
        <strong>{formatNumber(summary?.iqr ?? null)}</strong>
        <span>Std. dev.</span>
        <strong>{formatNumber(summary?.standardDeviation ?? null)}</strong>
      </div>

      <div className="workflow-grid">
        <details className="tool-block collapsible-tool" open>
          <summary className="tool-block-summary">Preview Suggestions</summary>
          <div className="tool-block-body">
            <div className="inline-help-row">
              <InfoTip label="These tools suggest cells to inspect. They do not change your data." />
            </div>
          <div className="auto-tool-grid">
            <button
              type="button"
              onClick={showUnusualValues}
              disabled={!sheet}
              title="Finds values far below or above the middle range of the data. Method: Q1 - 1.5 x IQR to Q3 + 1.5 x IQR."
            >
              <span className="button-icon" aria-hidden="true">⌁</span>
              Outside typical range
            </button>
            <button
              type="button"
              onClick={showDuplicateValues}
              disabled={!sheet}
              title="Finds repeated non-empty values in this column. Most useful for ID, sample, plot, or record columns."
            >
              <span className="button-icon" aria-hidden="true">≡</span>
              Duplicate values
            </button>
            <button
              type="button"
              onClick={showDistribution}
              disabled={!sheet}
              title={
                plotType === 'histogram'
                  ? 'Switches back to the scatter plot for selecting points.'
                  : 'Switches to a histogram view of the selected value column.'
              }
            >
              <span className="button-icon" aria-hidden="true">⌂</span>
              {distributionLabel}
            </button>
          </div>
          <div className="z-preview-row" aria-label="Far from average preview settings">
            <button
              type="button"
              onClick={showZScoreOutliers}
              disabled={!sheet}
              title="Finds values unusually far from the column average. Method: z-score."
            >
              <span className="button-icon" aria-hidden="true">▥</span>
              Far from average
            </button>
            <label className="mini-field">
              <span>Z cutoff</span>
              <input value={zCutoff} onChange={(event) => setZCutoff(event.target.value)} placeholder="3" />
            </label>
          </div>
          </div>
        </details>

        <details className="tool-block collapsible-tool" open>
          <summary className="tool-block-summary">Value filter</summary>
          <div className="tool-block-body">
          <div className="inline-help-row">
            <InfoTip label="Preview values using a greater than, less than, or range rule." />
          </div>
          <p className="hint compact-help">Preview values using a greater than, less than, or range rule.</p>
          <div
            className={`threshold-row ${
              valueFilterMode === 'range'
                ? 'range-mode'
                : valueFilterMode === 'percentile'
                  ? 'percentile-mode'
                  : ''
            }`}
          >
            <select
              value={valueFilterMode}
              onChange={(event) =>
                setValueFilterMode(event.target.value as 'greater' | 'less' | 'range' | 'percentile')
              }
              aria-label="Value filter rule"
            >
              <option value="greater">Greater than</option>
              <option value="less">Less than</option>
              <option value="range">Range</option>
              <option value="percentile">Percentile</option>
            </select>
            {valueFilterMode === 'range' ? (
              <>
                <input value={rangeMin} onChange={(event) => setRangeMin(event.target.value)} placeholder="Min" />
                <input value={rangeMax} onChange={(event) => setRangeMax(event.target.value)} placeholder="Max" />
                <select
                  value={rangeMatchMode}
                  onChange={(event) => setRangeMatchMode(event.target.value as 'inside' | 'outside')}
                  aria-label="Range preview mode"
                >
                  <option value="inside">Inside range</option>
                  <option value="outside">Outside range</option>
                </select>
              </>
            ) : valueFilterMode === 'percentile' ? (
              <>
                <input
                  value={lowerPercentile}
                  onChange={(event) => setLowerPercentile(event.target.value)}
                  placeholder="Lower percentile"
                />
                <input
                  value={upperPercentile}
                  onChange={(event) => setUpperPercentile(event.target.value)}
                  placeholder="Upper percentile"
                />
              </>
            ) : (
              <input value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Value" />
            )}
            <button type="button" onClick={previewThreshold} disabled={!sheet}>
              {valueFilterButtonLabel}
            </button>
          </div>
          </div>
        </details>

        <details className="tool-block highlight-block collapsible-tool" open>
          <summary className="tool-block-summary">Apply Highlight</summary>
          <div className="tool-block-body">
          <div className="inline-help-row">
            <InfoTip label="Highlights are persistent review decisions. They stay visible until Remove highlight is used." />
          </div>
          <div className="mark-grid">
            <button
              type="button"
              className="review-button"
              onClick={() => markTargets('review')}
              disabled={targetCount === 0}
              title="Yellow highlight. Use for values you want to inspect later."
            >
              <span className="button-icon review-icon" aria-hidden="true">⚑</span>
              Flag for review
            </button>
            <button
              type="button"
              className="problem-button"
              onClick={() => markTargets('problem')}
              disabled={targetCount === 0}
              title="Red highlight. Use for values that are likely incorrect."
            >
              <span className="button-icon problem-icon" aria-hidden="true">△</span>
              Mark as problem
            </button>
            <button
              type="button"
              className="keep-button"
              onClick={() => markTargets('keep')}
              disabled={targetCount === 0}
              title="Green highlight. Use for values you reviewed and decided to keep."
            >
              <span className="button-icon keep-icon" aria-hidden="true">✓</span>
              Mark as accepted
            </button>
            <div className="custom-highlight-row">
              <input
                type="color"
                value={customColor}
                onChange={(event) => setCustomColor(event.target.value)}
                aria-label="Choose custom highlight color"
                title="Choose custom highlight color"
              />
              <button
                type="button"
                onClick={() => markTargets('custom', customColor)}
                disabled={targetCount === 0}
                title="Applies the chosen custom color as a persistent highlight."
              >
                <span className="button-icon" aria-hidden="true">◇</span>
                Custom
              </button>
            </div>
            <button
              type="button"
              onClick={clearTargetMarks}
              disabled={targetCount === 0}
              title="Removes persistent highlight marks from selected or previewed cells. Raw values are not changed."
            >
              <span className="button-icon" aria-hidden="true">×</span>
              Remove highlight
            </button>
          </div>
          </div>
        </details>
      </div>
      {message ? <p className="hint">{message}</p> : null}
      </div>
    </details>
  )
}
