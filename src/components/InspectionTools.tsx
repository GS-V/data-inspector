import { useMemo, useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { PreviewCell, RawCellValue } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { getEffectiveValue, isMissing, toNumber } from '../utils/numeric'
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
    clearSelection,
    clearPreview,
  } = useDataInspectorStore()
  const [threshold, setThreshold] = useState('')
  const [thresholdDirection, setThresholdDirection] = useState<'greater' | 'less'>('greater')
  const [rangeMin, setRangeMin] = useState('')
  const [rangeMax, setRangeMax] = useState('')
  const [zCutoff, setZCutoff] = useState('3')
  const [message, setMessage] = useState('')

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const summary = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return null
    }
    return summarizeColumn(sheet.rows, sheet.name, selectedColumn, cellState)
  }, [cellState, selectedColumn, sheet])

  function buildPreview(
    method: string,
    predicate: (value: number | null, effectiveValue: RawCellValue, rowIndex: number) => string | null,
  ) {
    if (!sheet || !selectedColumn) {
      return
    }

    const previewCells: PreviewCell[] = []
    sheet.rows.forEach((row, rowIndex) => {
      const cellId = makeCellId(sheet.name, rowIndex, selectedColumn)
      const effectiveValue = getEffectiveValue(row[selectedColumn], cellState[cellId])
      const numericValue = toNumber(effectiveValue)
      const reason = predicate(numericValue, effectiveValue, rowIndex)
      if (!reason) {
        return
      }

      previewCells.push({
        cellId,
        sheetName: sheet.name,
        rowIndex,
        columnName: selectedColumn,
        value: effectiveValue,
        method,
        reason,
      })
    })

    setPreviewCells(previewCells)
    setMessage(`${previewCells.length.toLocaleString()} value${previewCells.length === 1 ? '' : 's'} previewed. New previews replace the previous preview.`)
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
    const thresholdValue = parseInput(threshold)
    if (thresholdValue === null) {
      setMessage('Enter a threshold first.')
      return
    }

    buildPreview('Preview threshold', (value) => {
      if (value === null) {
        return null
      }
      const matches =
        thresholdDirection === 'greater' ? value > thresholdValue : value < thresholdValue
      if (!matches) {
        return null
      }
      return `Value ${formatNumber(value)} is ${thresholdDirection === 'greater' ? 'greater than' : 'less than'} ${thresholdValue}`
    })
  }

  function previewOutsideRange() {
    const minimum = parseInput(rangeMin)
    const maximum = parseInput(rangeMax)
    if (minimum === null || maximum === null || minimum > maximum) {
      setMessage('Enter a valid minimum and maximum.')
      return
    }

    buildPreview('Preview outside range', (value) =>
      value !== null && (value < minimum || value > maximum)
        ? `Value ${formatNumber(value)} is outside ${minimum} to ${maximum}`
        : null,
    )
  }

  function showUnusualValues() {
    if (!summary || summary.q1 === null || summary.q3 === null || summary.iqr === null) {
      setMessage('There are not enough numeric values for this preview.')
      return
    }

    const lowerFence = summary.q1 - 1.5 * summary.iqr
    const upperFence = summary.q3 + 1.5 * summary.iqr

    buildPreview('Outside typical range', (value) =>
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

    buildPreview('Far from average', (value) => {
      if (value === null || summary.mean === null || summary.standardDeviation === null) {
        return null
      }
      const zScore = Math.abs((value - summary.mean) / summary.standardDeviation)
      return zScore >= cutoff ? `z-score=${formatNumber(zScore, 2)}, cutoff=${cutoff}` : null
    })
  }

  function showMissingValues() {
    buildPreview('Show missing values', (_value, effectiveValue) =>
      isMissing(effectiveValue) ? 'Value is blank or missing' : null,
    )
  }

  const selectedCount = Object.keys(selectedCells).length
  const previewCount = Object.keys(previewCells).length
  const targetCount = new Set([...Object.keys(selectedCells), ...Object.keys(previewCells)]).size
  const distributionLabel = plotType === 'histogram' ? 'Show scatter' : 'Show distribution'

  return (
    <section className="panel tools-panel">
      <div className="panel-title with-tip">
        <span>Find and Highlight Values</span>
        <InfoTip label="Preview finds possible values to inspect. It does not change your data." />
      </div>
      <p className="hint tool-intro">Preview suggestions first, select the values you want, then apply a persistent highlight.</p>
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

      <div className="tool-block">
        <div className="tool-block-title">
          <span>Threshold preview</span>
          <InfoTip label="Finds values greater than or less than the threshold you enter." />
        </div>
        <div className="threshold-row">
          <input value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Threshold" />
          <select
            value={thresholdDirection}
            onChange={(event) => setThresholdDirection(event.target.value as 'greater' | 'less')}
            aria-label="Threshold direction"
          >
            <option value="greater">Greater than</option>
            <option value="less">Less than</option>
          </select>
          <button type="button" onClick={previewThreshold} disabled={!sheet}>
            Preview
          </button>
        </div>
      </div>

      <div className="tool-block">
        <div className="tool-block-title">
          <span>Range preview</span>
          <InfoTip label="Finds values below the minimum or above the maximum." />
        </div>
        <div className="range-row">
          <input value={rangeMin} onChange={(event) => setRangeMin(event.target.value)} placeholder="Min" />
          <input value={rangeMax} onChange={(event) => setRangeMax(event.target.value)} placeholder="Max" />
          <button type="button" onClick={previewOutsideRange} disabled={!sheet}>
            Preview outside range
          </button>
        </div>
      </div>

      <div className="tool-block">
        <div className="tool-block-title">
          <span>Automated preview</span>
          <InfoTip label="These tools suggest cells to inspect. They do not change your data." />
        </div>
        <div className="auto-tool-grid">
          <button
            type="button"
            onClick={showUnusualValues}
            disabled={!sheet}
            title="Finds values far below or above the middle range of the data. Method: Q1 - 1.5 x IQR to Q3 + 1.5 x IQR."
          >
            Outside typical range
          </button>
          <button
            type="button"
            onClick={showZScoreOutliers}
            disabled={!sheet}
            title="Finds values unusually far from the column average. Method: z-score."
          >
            Far from average
          </button>
          <button
            type="button"
            onClick={showMissingValues}
            disabled={!sheet}
            title="Finds blank or missing values in the selected column."
          >
            Missing values
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
            {distributionLabel}
          </button>
        </div>
        <div className="z-cutoff-row">
          <label className="mini-field">
            <span>Z cutoff</span>
            <input value={zCutoff} onChange={(event) => setZCutoff(event.target.value)} placeholder="3" />
          </label>
        </div>
      </div>

      <div className="tool-block">
        <div className="tool-block-title">
          <span>Select values</span>
          <InfoTip label="Selection is temporary. Select points on the chart or toggle rows in the table, then apply a highlight." />
        </div>
        <div className="compact-button-row">
          <button type="button" onClick={clearSelection} disabled={selectedCount === 0}>
            Clear selection
          </button>
          <button type="button" onClick={clearPreview} disabled={previewCount === 0}>
            Clear preview
          </button>
        </div>
      </div>

      <div className="tool-block">
        <div className="tool-block-title">
          <span>Apply highlight</span>
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
            Flag for review
          </button>
          <button
            type="button"
            className="problem-button"
            onClick={() => markTargets('problem')}
            disabled={targetCount === 0}
            title="Red highlight. Use for values that are likely incorrect."
          >
            Mark as problem
          </button>
          <button
            type="button"
            className="keep-button"
            onClick={() => markTargets('keep')}
            disabled={targetCount === 0}
            title="Green highlight. Use for values you reviewed and decided to keep."
          >
            Mark as accepted
          </button>
          <button
            type="button"
            onClick={clearTargetMarks}
            disabled={targetCount === 0}
            title="Removes persistent highlight marks from selected or previewed cells. Raw values are not changed."
          >
            Remove highlight
          </button>
        </div>
      </div>
      {message ? <p className="hint">{message}</p> : null}
    </section>
  )
}
