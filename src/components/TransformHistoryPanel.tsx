import { NORMALITY_TEST_LABELS, NormalitySide } from './NormalityResult'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { TransformationType } from '../types/data'
import { formatNumber } from '../utils/stats'
import { TRANSFORM_INFO } from '../utils/transformLabels'

function transformTitle(type: TransformationType, lambda?: number): string {
  if (type === 'boxcox') {
    return `Box-Cox (λ=${(lambda ?? 1).toFixed(2)})`
  }
  return TRANSFORM_INFO[type].label
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

export function TransformHistoryPanel() {
  const transformHistory = useDataInspectorStore((state) => state.transformHistory)
  const applyColumnTransform = useDataInspectorStore((state) => state.applyColumnTransform)

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
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="transform-history-entry"
                onClick={() => applyColumnTransform(entry.columns, entry.type, { lambda: entry.lambda, useOffset: entry.useOffset })}
                title="Re-apply this transformation as a new step. This does not restore old values."
              >
                <div className="transform-history-row">
                  <div className="transform-history-main">
                    <strong>{transformTitle(entry.type, entry.lambda)}</strong>
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
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
