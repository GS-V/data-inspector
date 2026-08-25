import { useState } from 'react'
import { Icon } from './Icon'
import { NORMALITY_TEST_LABELS, NormalitySide } from './NormalityResult'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { TransformAttempt, TransformationType } from '../types/data'
import { formatNumber } from '../utils/stats'
import { transformDisplayLabel } from '../utils/transformLabels'
import { transformToPython, transformToR } from '../utils/transformCode'

function transformTitle(type: TransformationType, lambda?: number, base?: number): string {
  if (type === 'boxcox') {
    return `Box-Cox (λ=${(lambda ?? 1).toFixed(2)})`
  }
  return transformDisplayLabel(type, base)
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Sparkline({ before, after }: { before: number[]; after: number[] }) {
  const rowHeight = 10
  const gap = 4
  const width = 80
  const height = rowHeight * 2 + gap
  const bucketCount = Math.max(before.length, after.length, 1)
  const barWidth = width / bucketCount
  const max = Math.max(1, ...before, ...after)

  function renderRow(buckets: number[], yOffset: number, opacity: number) {
    return buckets.map((count, index) => {
      const barHeight = (count / max) * rowHeight
      return (
        <rect
          key={index}
          x={index * barWidth}
          y={yOffset + (rowHeight - barHeight)}
          width={Math.max(barWidth - 1, 1)}
          height={Math.max(barHeight, 0.5)}
          fill="var(--accent)"
          opacity={opacity}
        />
      )
    })
  }

  return (
    <svg
      className="transform-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Distribution shape before and after this transform"
    >
      {renderRow(before, 0, 0.35)}
      {renderRow(after, rowHeight + gap, 1)}
    </svg>
  )
}

function TransformCodeControls({ entry }: { entry: TransformAttempt }) {
  const [language, setLanguage] = useState<'python' | 'r'>('python')
  const [copied, setCopied] = useState(false)

  function stopClick(event: { stopPropagation: () => void }) {
    event.stopPropagation()
  }

  async function handleCopy(event: React.MouseEvent) {
    stopClick(event)
    const code = language === 'python' ? transformToPython(entry) : transformToR(entry)
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="transform-code-row" onClick={stopClick} onKeyDown={stopClick}>
      <div className="code-lang-toggle" role="group" aria-label="Code language">
        <button
          type="button"
          className={language === 'python' ? 'code-lang-active' : ''}
          onClick={(event) => {
            stopClick(event)
            setLanguage('python')
          }}
        >
          Python
        </button>
        <button
          type="button"
          className={language === 'r' ? 'code-lang-active' : ''}
          onClick={(event) => {
            stopClick(event)
            setLanguage('r')
          }}
        >
          R
        </button>
      </div>
      <button type="button" className="transform-code-copy" onClick={handleCopy} title="Copy an equivalent code snippet for this transform to the clipboard.">
        <Icon name="copy" />
        {copied ? 'Copied!' : 'Copy as code'}
      </button>
    </div>
  )
}

export function TransformHistoryPanel() {
  const transformHistory = useDataInspectorStore((state) => state.transformHistory)
  const applyColumnTransform = useDataInspectorStore((state) => state.applyColumnTransform)
  const [replayBusyId, setReplayBusyId] = useState<string | null>(null)
  const [replayError, setReplayError] = useState('')

  function handleReplay(entry: TransformAttempt) {
    if (replayBusyId) {
      return
    }
    setReplayBusyId(entry.id)
    setReplayError('')
    window.setTimeout(() => {
      try {
        applyColumnTransform(entry.columns, entry.type, { lambda: entry.lambda, useOffset: entry.useOffset, base: entry.base })
      } catch (caughtError) {
        setReplayError(caughtError instanceof Error ? caughtError.message : 'Replay failed.')
      } finally {
        setReplayBusyId(null)
      }
    }, 0)
  }

  return (
    <div className="tool-block transform-history">
      <div className="tool-block-summary">Transform history</div>
      {transformHistory.length === 0 ? (
        <p className="hint">No transformations applied yet this session.</p>
      ) : (
        <div className="transform-history-list">
          {transformHistory
            .slice()
            .reverse()
            .map((entry) => {
              const isBusy = replayBusyId === entry.id
              const isDisabled = replayBusyId !== null
              return (
                <div
                  key={entry.id}
                  className="transform-history-entry"
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  aria-disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return
                    handleReplay(entry)
                  }}
                  onKeyDown={(event) => {
                    if (isDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleReplay(entry)
                    }
                  }}
                  title="Re-apply this transformation as a new step. This does not restore old values."
                >
                  <div className="transform-history-row">
                    <div className="transform-history-main">
                      <strong>
                        {isBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : null}
                        {transformTitle(entry.type, entry.lambda, entry.base)}
                      </strong>
                      <span className="transform-history-columns">{entry.columns.join(', ')}</span>
                    </div>
                    <Sparkline before={entry.sparkBefore} after={entry.sparkAfter} />
                  </div>
                  <div className="transform-history-stats">
                    <span>Skew {formatNumber(entry.skewnessBefore, 2)} → {formatNumber(entry.skewnessAfter, 2)}</span>
                    <span>Mean {formatNumber(entry.statsBefore.mean, 2)} → {formatNumber(entry.statsAfter.mean, 2)}</span>
                    <span>SD {formatNumber(entry.statsBefore.standardDeviation, 2)} → {formatNumber(entry.statsAfter.standardDeviation, 2)}</span>
                    <span className="transform-history-time">{formatTimestamp(entry.appliedAt)}</span>
                  </div>
                  <div className="normality-block">
                    <div className="normality-header">
                      {NORMALITY_TEST_LABELS[entry.normalityTestType]}, α = {entry.normalityThreshold}
                    </div>
                    <div className="normality-sides">
                      <NormalitySide label="Before" result={entry.normalityBefore} threshold={entry.normalityThreshold} />
                      <NormalitySide label="After" result={entry.normalityAfter} threshold={entry.normalityThreshold} />
                    </div>
                  </div>
                  <TransformCodeControls entry={entry} />
                </div>
              )
            })}
        </div>
      )}
      {replayError ? <p className="error-text">{replayError}</p> : null}
      {replayBusyId !== null ? (
        <div className="panel-loading-overlay" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Applying transform…</span>
        </div>
      ) : null}
    </div>
  )
}
