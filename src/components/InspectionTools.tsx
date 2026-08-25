import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { InfoTip } from './InfoTip'
import { ModalPortal } from './ModalPortal'
import { NormalitySide } from './NormalityResult'
import { TransformHistoryPanel } from './TransformHistoryPanel'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type {
  NormalityTestResult,
  NormalityTestType,
  PlotType,
  PreviewCell,
  RawCellValue,
  TransformationType,
} from '../types/data'
import { NORMALITY_TEST_OPTIONS, PLOT_TYPE_OPTIONS } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { findNumericColumns, getDisplayValue, getEffectiveValue, toNumber } from '../utils/numeric'
import { duplicateValueKeys, percentileBounds } from '../utils/reviewChecks'
import { formatNumber, summarizeColumn } from '../utils/stats'
import { TRANSFORM_INFO, transformDisplayLabel } from '../utils/transformLabels'
import {
  estimateOptimalBoxCoxLambda,
  getColumnNumericValues,
  suggestAlternativeTransforms,
  validateTransformFeasibility,
} from '../utils/transforms'

type InfeasibleDialogState = {
  type: TransformationType
  columns: string[]
  lambda?: number
  base?: number
  zeroNegativeCount: number
  totalCount: number
  issues: string[]
}

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
    applyColumnTransform,
    normalityTestType,
    normalityThreshold,
    setNormalityTestType,
    setNormalityThreshold,
    checkColumnNormality,
    normalizationMode,
    logBase,
    setNormalizationMode,
    setLogBase,
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
  const [mode, setMode] = useState<'review' | 'transform'>('review')
  const [targetMode, setTargetMode] = useState<'current' | 'selected'>('current')
  const [batchColumns, setBatchColumns] = useState<string[]>([])
  const [boxcoxAutoOptimize, setBoxcoxAutoOptimize] = useState(true)
  const [boxcoxLambda, setBoxcoxLambda] = useState('1.00')
  const [offsetChoice, setOffsetChoice] = useState<'skip' | 'offset'>('skip')
  const [logBaseInput, setLogBaseInput] = useState(String(logBase))
  const [infeasibleDialog, setInfeasibleDialog] = useState<InfeasibleDialogState | null>(null)
  const [normalityCheck, setNormalityCheck] = useState<{ columns: string[]; result: NormalityTestResult } | null>(null)

  const sheet = workbook?.sheets.find((item) => item.name === activeSheetName)
  const summary = useMemo(() => {
    if (!sheet || !selectedColumn) {
      return null
    }
    return summarizeColumn(sheet.rows, sheet.name, selectedColumn, cellState)
  }, [cellState, selectedColumn, sheet])

  const numericColumns = useMemo(() => {
    if (!sheet) {
      return []
    }
    return findNumericColumns(sheet.rows, sheet.columns)
  }, [sheet])

  const targetColumns =
    targetMode === 'current'
      ? selectedColumn
        ? [selectedColumn]
        : []
      : batchColumns.filter((column) => numericColumns.includes(column))

  const transformBaseDisabled = !sheet || !selectedColumn || !summary || summary.count < 2
  const transformDisabled = transformBaseDisabled || targetColumns.length === 0
  const zScoreUndefined = !summary || summary.standardDeviation === null || summary.standardDeviation === 0
  const zScoreDisabled = transformDisabled || zScoreUndefined
  const zScoreTitle = zScoreUndefined
    ? 'All values are identical; z-score is undefined.'
    : 'Standardizes values using (x - mean) / standard deviation. Values must be numeric.'

  const targetColumnsKey = targetColumns.join(',')
  const [lastNormalityCheckKey, setLastNormalityCheckKey] = useState(targetColumnsKey)
  if (targetColumnsKey !== lastNormalityCheckKey) {
    setLastNormalityCheckKey(targetColumnsKey)
    setNormalityCheck(null)
  }

  function runNormalityCheck() {
    if (targetColumns.length === 0) {
      setMessage('Choose at least one numeric column to check.')
      return
    }
    const result = checkColumnNormality(targetColumns)
    setNormalityCheck(result ? { columns: targetColumns, result } : null)
  }

  function toggleBatchColumn(column: string) {
    setBatchColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    )
  }

  function finalizeTransform(
    type: TransformationType,
    columns: string[],
    lambda: number | undefined,
    useOffset: boolean,
    base?: number,
  ) {
    const { appliedCount, skippedCount } = applyColumnTransform(columns, type, { lambda, useOffset, base })
    let text = `${transformDisplayLabel(type, base)} applied to ${appliedCount.toLocaleString()} value${appliedCount === 1 ? '' : 's'}${
      skippedCount > 0 ? ` (${skippedCount.toLocaleString()} skipped)` : ''
    } across ${columns.length.toLocaleString()} column${columns.length === 1 ? '' : 's'}.`
    if (plotType === 'scatter') {
      text += ' Switch to Histogram or Q-Q plot to see the effect.'
    }
    setMessage(text)
    setInfeasibleDialog(null)
  }

  function runTransform(type: TransformationType, base?: number) {
    if (!sheet || targetColumns.length === 0) {
      setMessage('Choose at least one numeric column to transform.')
      return
    }

    let lambda: number | undefined
    if (type === 'boxcox') {
      if (boxcoxAutoOptimize) {
        const combined = targetColumns.flatMap((column) => getColumnNumericValues(sheet, column, cellState))
        lambda = estimateOptimalBoxCoxLambda(combined)
        setBoxcoxLambda(lambda.toFixed(2))
      } else {
        const parsed = Number(boxcoxLambda)
        lambda = Number.isFinite(parsed) ? parsed : 1
      }
    }

    const combinedValues = targetColumns.flatMap((column) => getColumnNumericValues(sheet, column, cellState))
    const feasibility = validateTransformFeasibility(combinedValues, type)

    if (!feasibility.feasible) {
      setOffsetChoice('skip')
      setInfeasibleDialog({
        type,
        columns: targetColumns,
        lambda,
        base,
        zeroNegativeCount: feasibility.zeroNegativeCount,
        totalCount: combinedValues.length,
        issues: feasibility.issues,
      })
      return
    }

    finalizeTransform(type, targetColumns, lambda, false, base)
  }

  function confirmInfeasibleTransform() {
    if (!infeasibleDialog) {
      return
    }
    finalizeTransform(
      infeasibleDialog.type,
      infeasibleDialog.columns,
      infeasibleDialog.lambda,
      offsetChoice === 'offset',
      infeasibleDialog.base,
    )
  }

  function cancelInfeasibleTransform() {
    setInfeasibleDialog(null)
    setMessage('Transform canceled. No values were changed.')
  }

  function handleNormalizeClick(nextMode: 'none' | 'log' | 'zscore') {
    setNormalizationMode(nextMode)
    if (nextMode === 'none') {
      return
    }
    if (nextMode === 'zscore') {
      runTransform('zscore')
      return
    }
    const parsedBase = Number(logBaseInput)
    if (!Number.isFinite(parsedBase) || parsedBase <= 1) {
      setMessage('Log base must be a number greater than 1.')
      return
    }
    setLogBase(parsedBase)
    runTransform('log10', parsedBase)
  }

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

      <div className="action-tab-bar">
        <button
          type="button"
          className={`action-tab${mode === 'review' ? ' action-tab-active' : ''}`}
          onClick={() => setMode('review')}
        >
          Review
        </button>
        <button
          type="button"
          className={`action-tab${mode === 'transform' ? ' action-tab-active' : ''}`}
          onClick={() => setMode('transform')}
        >
          Transform
        </button>
      </div>

      {mode === 'review' ? (
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
              title="Flags values outside the typical spread of this column — below Q1 − 1.5×IQR or above Q3 + 1.5×IQR (Tukey's fence), the standard rule of thumb for outlier screening."
            >
              <Icon name="outlier" />
              Outside typical range
            </button>
            <button
              type="button"
              onClick={showDuplicateValues}
              disabled={!sheet}
              title="Finds repeated non-empty values in this column — most useful for ID, sample, plot, or record columns."
            >
              <Icon name="copy" />
              Duplicate values
            </button>
            <label className="mini-field chart-type-field">
              <span>Chart type</span>
              <select
                value={plotType}
                onChange={(event) => setPlotType(event.target.value as PlotType)}
                disabled={!sheet}
                title="Changes the chart shown in the chart panel."
              >
                {PLOT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="z-preview-row" aria-label="Far from average preview settings">
            <button
              type="button"
              onClick={showZScoreOutliers}
              disabled={!sheet}
              title="Flags values whose z-score — z = (x − mean) / SD — is at or beyond the cutoff you set below; e.g. a cutoff of 3 flags anything more than 3 standard deviations from the average."
            >
              <Icon name="distance" />
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
              <Icon name="flag" className="review-icon" />
              Flag for review
            </button>
            <button
              type="button"
              className="problem-button"
              onClick={() => markTargets('problem')}
              disabled={targetCount === 0}
              title="Red highlight. Use for values that are likely incorrect."
            >
              <Icon name="alert" className="problem-icon" />
              Mark as problem
            </button>
            <button
              type="button"
              className="keep-button"
              onClick={() => markTargets('keep')}
              disabled={targetCount === 0}
              title="Green highlight. Use for values you reviewed and decided to keep."
            >
              <Icon name="check-circle" className="keep-icon" />
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
                <Icon name="palette" />
                Custom color
              </button>
            </div>
            <button
              type="button"
              onClick={clearTargetMarks}
              disabled={targetCount === 0}
              title="Removes persistent highlight marks from selected or previewed cells. Raw values are not changed."
            >
              <Icon name="x-circle" />
              Remove highlight
            </button>
          </div>
          </div>
        </details>
      </div>
      ) : (
      <>
      <div className="workflow-grid">
        <div className="tool-block">
          <div className="tool-block-summary">Target columns</div>
          <label className="field">
            <span>Apply to</span>
            <select
              value={targetMode}
              onChange={(event) => setTargetMode(event.target.value as 'current' | 'selected')}
            >
              <option value="current">Current column</option>
              <option value="selected">Selected columns</option>
            </select>
          </label>
          {targetMode === 'current' ? (
            <p className="hint compact-help">{selectedColumn || 'No column selected.'}</p>
          ) : numericColumns.length === 0 ? (
            <p className="hint compact-help">No numeric columns available.</p>
          ) : (
            <div className="batch-column-list">
              {numericColumns.map((column) => (
                <label key={column} className="transform-checkbox-row">
                  <input
                    type="checkbox"
                    checked={batchColumns.includes(column)}
                    onChange={() => toggleBatchColumn(column)}
                  />
                  {column}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="tool-block">
          <div className="tool-block-summary">Apply transformation</div>
          <div className="transform-grid">
            {(() => {
              const info = TRANSFORM_INFO.log
              return (
                <div
                  key="log"
                  className="xform-card"
                  role="button"
                  tabIndex={transformDisabled ? -1 : 0}
                  aria-disabled={transformDisabled}
                  onClick={() => {
                    if (transformDisabled) return
                    runTransform('log')
                  }}
                  onKeyDown={(event) => {
                    if (transformDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      runTransform('log')
                    }
                  }}
                >
                  <span className="icon-wrap">
                    <Icon name={info.icon} />
                  </span>
                  <span className="xform-card-body">
                    <span className="xform-card-title-row">
                      <strong>{info.label}</strong>
                      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <InfoTip label={info.math} />
                      </span>
                    </span>
                    <span className="xform-card-effect">{info.effect}</span>
                  </span>
                </div>
              )
            })()}
            {/*
              Normalize card: replaces the former standalone "Log (base 10)" and "Z-Score" xform
              cards with one None/Log/Z-score control. Log now supports a user-chosen base (not
              just 10); each mode button both selects and immediately applies that transform, same
              as the cards it replaced -- "None" is the exception, since there's no data mutation
              for it to apply, so clicking it only updates which segment is shown as active.
            */}
            <div className="xform-card xform-card-normalize" aria-label="Normalize">
              <span className="icon-wrap">
                <Icon name="compress" />
              </span>
              <span className="xform-card-body">
                <span className="xform-card-title-row">
                  <strong>Normalize</strong>
                  <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <InfoTip label="Choose how this column is rescaled. Log: y = log_b(x) = ln(x) / ln(b), requires x > 0. Z-score: y = (x − mean) / SD, for comparing columns. Clicking a mode applies it immediately." />
                  </span>
                </span>
                <div className="normalize-mode-toggle" role="group" aria-label="Normalization mode">
                  <button
                    type="button"
                    className={normalizationMode === 'none' ? 'normalize-mode-active' : ''}
                    onClick={() => handleNormalizeClick('none')}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    className={normalizationMode === 'log' ? 'normalize-mode-active' : ''}
                    disabled={transformDisabled}
                    title="y = log_b(x) = ln(x) / ln(b), requires x > 0."
                    onClick={() => handleNormalizeClick('log')}
                  >
                    Log
                  </button>
                  <button
                    type="button"
                    className={normalizationMode === 'zscore' ? 'normalize-mode-active' : ''}
                    disabled={zScoreDisabled}
                    title={zScoreTitle}
                    onClick={() => handleNormalizeClick('zscore')}
                  >
                    Z-score
                  </button>
                </div>
                {normalizationMode === 'log' ? (
                  <label
                    className="normalize-base-field"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <span>Base</span>
                    <input
                      value={logBaseInput}
                      onChange={(event) => setLogBaseInput(event.target.value)}
                      placeholder="10"
                    />
                  </label>
                ) : null}
                <span className="xform-card-effect">
                  {normalizationMode === 'log'
                    ? `Log-transforms values on the base you set (values must be > 0)`
                    : normalizationMode === 'zscore'
                      ? 'Rescales to mean 0, SD 1 — for comparing columns'
                      : 'No normalization applied'}
                </span>
              </span>
            </div>
            {(['sqrt', 'boxcox'] as const).map((type) => {
              const info = TRANSFORM_INFO[type]
              return (
                <div
                  key={type}
                  className="xform-card"
                  role="button"
                  tabIndex={transformDisabled ? -1 : 0}
                  aria-disabled={transformDisabled}
                  onClick={() => {
                    if (transformDisabled) return
                    runTransform(type)
                  }}
                  onKeyDown={(event) => {
                    if (transformDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      runTransform(type)
                    }
                  }}
                >
                  <span className="icon-wrap">
                    <Icon name={info.icon} />
                  </span>
                  <span className="xform-card-body">
                    <span className="xform-card-title-row">
                      <strong>{info.label}</strong>
                      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <InfoTip label={info.math} />
                      </span>
                    </span>
                    <span className="xform-card-effect">{info.effect}</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="normality-settings-row" aria-label="Box-Cox lambda settings">
            <label className="transform-checkbox-row">
              <input
                type="checkbox"
                checked={boxcoxAutoOptimize}
                onChange={(event) => setBoxcoxAutoOptimize(event.target.checked)}
              />
              Auto-pick the best exponent
              <InfoTip label="Runs a grid search over λ from −2 to 2 in 0.05 steps and keeps the value whose transformed skewness is closest to zero — a practical stand-in for 'closest to normal' that's much cheaper to compute than full maximum-likelihood Box-Cox estimation. Turn this off to set λ yourself." />
            </label>
            <label className="normality-field-inline">
              <span>λ</span>
              <input
                value={boxcoxLambda}
                onChange={(event) => setBoxcoxLambda(event.target.value)}
                disabled={boxcoxAutoOptimize}
                placeholder="1.00"
              />
            </label>
          </div>
          <div className="normality-fields-grid" aria-label="Normality test settings">
            <label className="normality-field">
              <span>
                Normality test
                <InfoTip label="Shapiro-Wilk (default) — compares the ordered sample values against the values expected from a true normal distribution; the closer the fit, the higher the W statistic and p-value. Most reliable for small-to-medium samples (n < 5000). Jarque-Bera — builds a chi-square statistic from the sample's skewness and kurtosis; suits very large samples where Shapiro-Wilk loses power. Anderson-Darling — a weighted comparison of the empirical and theoretical CDFs that weights the tails more heavily, so it's more sensitive to outliers than the other two." />
              </span>
              <select
                value={normalityTestType}
                onChange={(event) => setNormalityTestType(event.target.value as NormalityTestType)}
              >
                {NORMALITY_TEST_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="normality-field">
              <span>
                α (significance level)
                <InfoTip label="α is the significance threshold: if the test's p-value is ≤ α, there's enough evidence to say this column doesn't look normal (reject normality). If p > α, there isn't enough evidence to say it's abnormal — that is not the same as proving it is normal. 0.05 is standard; lowering it (e.g. to 0.01) makes the test more lenient about calling data normal." />
              </span>
              <input
                type="number"
                step="0.01"
                min="0.001"
                max="0.5"
                value={normalityThreshold}
                onChange={(event) => setNormalityThreshold(Number(event.target.value))}
              />
            </label>
          </div>
          <p className="hint compact-help">Typical values: 0.01–0.10 (default 0.05)</p>
          <button
            type="button"
            className="check-normality-button"
            onClick={runNormalityCheck}
            disabled={transformDisabled}
            title="Checks the current values of the target column(s) against the active test and threshold. Does not transform anything."
          >
            <Icon name="bell" />
            Check normality
          </button>
          {normalityCheck ? (
            <NormalitySide label="Current" result={normalityCheck.result} threshold={normalityThreshold} />
          ) : null}
        </div>
      </div>
      <TransformHistoryPanel />
      </>
      )}
      {message ? <p className="hint">{message}</p> : null}

      {infeasibleDialog ? (
        <ModalPortal>
          <div
            className="reason-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transform-infeasible-title"
          >
            <div className="reason-modal-header">
              <div>
                <h2 id="transform-infeasible-title">Some values can&apos;t be transformed</h2>
                <p>{infeasibleDialog.issues.join(' ')}</p>
              </div>
            </div>
            <div className="reason-modal-action">
              {`${transformDisplayLabel(infeasibleDialog.type, infeasibleDialog.base)} on ${infeasibleDialog.columns.length.toLocaleString()} column${
                infeasibleDialog.columns.length === 1 ? '' : 's'
              }`}
            </div>
            <p className="transform-warning">
              {`${infeasibleDialog.zeroNegativeCount.toLocaleString()} of ${infeasibleDialog.totalCount.toLocaleString()} value${
                infeasibleDialog.totalCount === 1 ? '' : 's'
              } cannot be transformed as-is.`}
            </p>
            {infeasibleDialog.type === 'log' || infeasibleDialog.type === 'log10' ? (
              <div className="field">
                <span>How should these values be handled?</span>
                <label className="transform-checkbox-row">
                  <input
                    type="radio"
                    name="infeasible-choice"
                    checked={offsetChoice === 'skip'}
                    onChange={() => setOffsetChoice('skip')}
                  />
                  Skip these values, transform the rest
                </label>
                <label className="transform-checkbox-row">
                  <input
                    type="radio"
                    name="infeasible-choice"
                    checked={offsetChoice === 'offset'}
                    onChange={() => setOffsetChoice('offset')}
                  />
                  Add +1 to every value first, then transform
                </label>
              </div>
            ) : (
              <p className="reason-modal-helper">
                These values will be skipped. The rest of the column will still be transformed.
              </p>
            )}
            <p className="reason-modal-helper">
              Alternatively, try:{' '}
              {suggestAlternativeTransforms(infeasibleDialog.type)
                .map((alternative) => TRANSFORM_INFO[alternative].label)
                .join(', ')}
              .
            </p>
            <div className="modal-actions">
              <button type="button" onClick={cancelInfeasibleTransform}>
                Cancel
              </button>
              <button type="button" className="primary-action" onClick={confirmInfeasibleTransform}>
                Apply transform
              </button>
            </div>
          </div>
        </ModalPortal>
      ) : null}
      </div>
    </details>
  )
}
