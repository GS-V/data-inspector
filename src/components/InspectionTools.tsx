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
  const [logBaseInput, setLogBaseInput] = useState('10')
  const [infeasibleDialog, setInfeasibleDialog] = useState<InfeasibleDialogState | null>(null)
  const [normalityCheck, setNormalityCheck] = useState<{ columns: string[]; result: NormalityTestResult } | null>(null)
  const [transformBusyType, setTransformBusyType] = useState<TransformationType | null>(null)
  const [normalityBusy, setNormalityBusy] = useState(false)
  const [markBusy, setMarkBusy] = useState<'review' | 'problem' | 'keep' | 'custom' | 'clear' | null>(null)
  const [logBaseError, setLogBaseError] = useState('')
  const [previewBusyKey, setPreviewBusyKey] = useState<'outlier' | 'duplicate' | 'zscore' | 'threshold' | null>(null)

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

  // These track whatever the Base field currently holds, not the last base applied.
  // The card title reads them, so it updates as the user types. Apply re-validates the base
  // before firing a transform, so a half-typed base can never reach applyColumnTransform.
  const parsedLogBase = Number(logBaseInput)
  const logBaseIsValid = Number.isFinite(parsedLogBase) && parsedLogBase > 1
  const logBaseTitleValue = Number.isFinite(parsedLogBase) ? parsedLogBase : 10

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
    if (normalityBusy) {
      return
    }
    setNormalityBusy(true)
    window.setTimeout(() => {
      try {
        const result = checkColumnNormality(targetColumns)
        setNormalityCheck(result ? { columns: targetColumns, result } : null)
      } finally {
        setNormalityBusy(false)
      }
    }, 0)
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
    if (transformBusyType) {
      return
    }

    setTransformBusyType(type)
    window.setTimeout(() => {
      try {
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
      } catch (caughtError) {
        setMessage(caughtError instanceof Error ? caughtError.message : 'Transform failed.')
      } finally {
        setTransformBusyType(null)
      }
    }, 0)
  }

  function confirmInfeasibleTransform() {
    if (!infeasibleDialog || transformBusyType) {
      return
    }
    const dialog = infeasibleDialog
    setTransformBusyType(dialog.type)
    window.setTimeout(() => {
      try {
        finalizeTransform(dialog.type, dialog.columns, dialog.lambda, offsetChoice === 'offset', dialog.base)
      } catch (caughtError) {
        setMessage(caughtError instanceof Error ? caughtError.message : 'Transform failed.')
      } finally {
        setTransformBusyType(null)
      }
    }, 0)
  }

  function cancelInfeasibleTransform() {
    setInfeasibleDialog(null)
    setMessage('Transform canceled. No values were changed.')
  }

  function handleLogApply() {
    if (!logBaseIsValid) {
      setLogBaseError('Base must be a number greater than 1.')
      return
    }
    setLogBaseError('')
    runTransform('log10', parsedLogBase)
  }

  function handleZScoreApply() {
    runTransform('zscore')
  }

  function runMarkAction(kind: 'review' | 'problem' | 'keep' | 'custom' | 'clear', action: () => void) {
    if (markBusy) {
      return
    }
    setMarkBusy(kind)
    window.setTimeout(() => {
      try {
        action()
      } finally {
        setMarkBusy(null)
      }
    }, 0)
  }

  // Shared wrapper for every preview-building button below. Each one scans the whole column,
  // an O(rows) pass that is cheap for a typical file and slow for a large one. Defer the scan by
  // one tick so the button's spinner can paint first.
  // buildPreview also handles toggling an active preview back off, which is instant. Deferring
  // that case too costs one extra render tick and changes no behavior.
  function runPreviewAction(key: 'outlier' | 'duplicate' | 'zscore' | 'threshold', action: () => void) {
    if (previewBusyKey) {
      return
    }
    setPreviewBusyKey(key)
    window.setTimeout(() => {
      try {
        action()
      } catch (caughtError) {
        setMessage(caughtError instanceof Error ? caughtError.message : 'Preview failed.')
      } finally {
        setPreviewBusyKey(null)
      }
    }, 0)
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
              onClick={() => runPreviewAction('outlier', showUnusualValues)}
              disabled={!sheet || previewBusyKey !== null}
              title="Flags values outside the typical spread of this column — below Q1 − 1.5×IQR or above Q3 + 1.5×IQR (Tukey's fence), the standard rule of thumb for outlier screening."
            >
              {previewBusyKey === 'outlier' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="outlier" />}
              Outside typical range
            </button>
            <button
              type="button"
              onClick={() => runPreviewAction('duplicate', showDuplicateValues)}
              disabled={!sheet || previewBusyKey !== null}
              title="Finds repeated non-empty values in this column — most useful for ID, sample, plot, or record columns."
            >
              {previewBusyKey === 'duplicate' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="copy" />}
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
              onClick={() => runPreviewAction('zscore', showZScoreOutliers)}
              disabled={!sheet || previewBusyKey !== null}
              title="Flags values whose z-score — z = (x − mean) / SD — is at or beyond the cutoff you set below; e.g. a cutoff of 3 flags anything more than 3 standard deviations from the average."
            >
              {previewBusyKey === 'zscore' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="distance" />}
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
            <button
              type="button"
              onClick={() => runPreviewAction('threshold', previewThreshold)}
              disabled={!sheet || previewBusyKey !== null}
            >
              {previewBusyKey === 'threshold' ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
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
              onClick={() => runMarkAction('review', () => markTargets('review'))}
              disabled={targetCount === 0 || markBusy !== null}
              title="Yellow highlight. Use for values you want to inspect later."
            >
              {markBusy === 'review' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="flag" className="review-icon" />}
              Flag for review
            </button>
            <button
              type="button"
              className="problem-button"
              onClick={() => runMarkAction('problem', () => markTargets('problem'))}
              disabled={targetCount === 0 || markBusy !== null}
              title="Red highlight. Use for values that are likely incorrect."
            >
              {markBusy === 'problem' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="alert" className="problem-icon" />}
              Mark as problem
            </button>
            <button
              type="button"
              className="keep-button"
              onClick={() => runMarkAction('keep', () => markTargets('keep'))}
              disabled={targetCount === 0 || markBusy !== null}
              title="Green highlight. Use for values you reviewed and decided to keep."
            >
              {markBusy === 'keep' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="check-circle" className="keep-icon" />}
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
                onClick={() => runMarkAction('custom', () => markTargets('custom', customColor))}
                disabled={targetCount === 0 || markBusy !== null}
                title="Applies the chosen custom color as a persistent highlight."
              >
                {markBusy === 'custom' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="palette" />}
                Custom color
              </button>
            </div>
            <button
              type="button"
              onClick={() => runMarkAction('clear', clearTargetMarks)}
              disabled={targetCount === 0 || markBusy !== null}
              title="Removes persistent highlight marks from selected or previewed cells. Raw values are not changed."
            >
              {markBusy === 'clear' ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="x-circle" />}
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

        <div className="tool-block transform-apply-block">
          <div className="tool-block-summary">Apply transformation</div>
          <div className="transform-grid">
            {(() => {
              const info = TRANSFORM_INFO.log
              const isBusy = transformBusyType === 'log'
              const isDisabled = transformDisabled || transformBusyType !== null
              return (
                <div
                  key="log"
                  className="xform-card"
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  aria-disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return
                    runTransform('log')
                  }}
                  onKeyDown={(event) => {
                    if (isDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      runTransform('log')
                    }
                  }}
                >
                  <span className="icon-wrap">
                    {isBusy ? <span className="spinner" aria-hidden="true" /> : <Icon name={info.icon} />}
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
              Log and Z-score get one independent card each, matching Square Root and Box-Cox.
              A single shared card with a None/Log/Z-score mode switcher replaced these earlier,
              and it made a transform too easy to fire by accident: an interaction meant only to
              change the selected mode could apply a transform or open its confirmation dialog.
              Keep each card self-contained. A card must fire a transform only from its own Apply
              click, so editing the Base field or tabbing through the form applies nothing.
              The wrapper keeps Z-score directly under Log, whatever the grid fits per row.
            */}
            <div className="xform-card-pair">
              <div className="xform-card xform-card-normalize" aria-label="Log (base N)">
                <span className="icon-wrap">
                  {transformBusyType === 'log10' ? <span className="spinner" aria-hidden="true" /> : <Icon name="compress" />}
                </span>
                <span className="xform-card-body">
                  <span className="xform-card-title-row">
                    <strong>{`Log (base ${logBaseTitleValue})`}</strong>
                    <InfoTip label="y = log_b(x) = ln(x) / ln(b), requires x > 0. Base updates the title as you type it, but nothing is applied until you click Apply." />
                  </span>
                  <span className="xform-card-effect">Log-transforms values using the base you set (values must be &gt; 0)</span>
                  <div className="xform-apply-row">
                    <label className="normalize-base-field">
                      <span>Base</span>
                      <input
                        value={logBaseInput}
                        onChange={(event) => {
                          setLogBaseInput(event.target.value)
                          setLogBaseError('')
                        }}
                        placeholder="10"
                        disabled={transformBusyType !== null}
                        aria-label="Log base"
                      />
                    </label>
                    <button
                      type="button"
                      className="xform-apply-btn"
                      onClick={handleLogApply}
                      disabled={transformDisabled || transformBusyType !== null}
                    >
                      {transformBusyType === 'log10' ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
                      Apply
                    </button>
                  </div>
                  {logBaseError ? <p className="error-text">{logBaseError}</p> : null}
                </span>
              </div>

              <div className="xform-card" aria-label="Z-score">
                <span className="icon-wrap">
                  {transformBusyType === 'zscore' ? <span className="spinner" aria-hidden="true" /> : <Icon name="bell" />}
                </span>
                <span className="xform-card-body">
                  <span className="xform-card-title-row">
                    <strong>Z-score</strong>
                    <InfoTip label={zScoreTitle} />
                  </span>
                  <span className="xform-card-effect">Rescales to mean 0, SD 1 — for comparing columns</span>
                  <div className="xform-apply-row">
                    <button
                      type="button"
                      className="xform-apply-btn"
                      onClick={handleZScoreApply}
                      disabled={zScoreDisabled || transformBusyType !== null}
                      title={zScoreTitle}
                    >
                      {transformBusyType === 'zscore' ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
                      Apply
                    </button>
                  </div>
                </span>
              </div>
            </div>
            {(['sqrt', 'boxcox'] as const).map((type) => {
              const info = TRANSFORM_INFO[type]
              const isBusy = transformBusyType === type
              const isDisabled = transformDisabled || transformBusyType !== null
              return (
                <div
                  key={type}
                  className="xform-card"
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  aria-disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return
                    runTransform(type)
                  }}
                  onKeyDown={(event) => {
                    if (isDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      runTransform(type)
                    }
                  }}
                >
                  <span className="icon-wrap">
                    {isBusy ? <span className="spinner" aria-hidden="true" /> : <Icon name={info.icon} />}
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
          {transformBusyType !== null ? (
            <div className="panel-loading-overlay" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>Applying transform…</span>
            </div>
          ) : null}
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
            disabled={transformDisabled || normalityBusy}
            title="Checks the current values of the target column(s) against the active test and threshold. Does not transform anything."
          >
            {normalityBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="bell" />}
            Check normality
          </button>
          {normalityBusy ? (
            <p className="hint normality-computing">
              <span className="spinner" aria-hidden="true" />
              Computing…
            </p>
          ) : normalityCheck ? (
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
              <button type="button" onClick={cancelInfeasibleTransform} disabled={transformBusyType !== null}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={confirmInfeasibleTransform}
                disabled={transformBusyType !== null}
              >
                {transformBusyType !== null ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
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
