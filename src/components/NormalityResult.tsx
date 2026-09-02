/* eslint-disable react-refresh/only-export-components -- these formatting helpers sit beside the
   small NormalitySide component that renders them. TransformHistoryPanel and the standalone
   "Check normality" action both reuse the pair. None of the helpers holds state, so splitting
   them into a second module would buy nothing and fast refresh has nothing to lose here. */
import type { NormalityTestResult, NormalityTestType } from '../types/data'
import { NORMALITY_TEST_OPTIONS } from '../types/data'

export const NORMALITY_TEST_LABELS = Object.fromEntries(
  NORMALITY_TEST_OPTIONS.map((option) => [option.value, option.label]),
) as Record<NormalityTestType, string>

export function formatPValue(pValue: number | null): string {
  if (pValue === null) {
    return 'p = -'
  }
  if (pValue < 0.001) {
    return 'p < 0.001'
  }
  return `p = ${pValue.toFixed(4)}`
}

export function normalityVerdict(
  result: NormalityTestResult | null,
  threshold: number,
): { label: string; tone: 'neutral' | 'keep' | 'problem' } {
  if (!result || result.pValue === null) {
    return { label: 'Not computed', tone: 'neutral' }
  }
  if (result.pValue > threshold) {
    return { label: 'Fails to reject normality (p > α)', tone: 'keep' }
  }
  return { label: 'Rejects normality (p ≤ α)', tone: 'problem' }
}

export function NormalitySide({
  label,
  result,
  threshold,
}: {
  label: string
  result: NormalityTestResult | null
  threshold: number
}) {
  const { label: verdictLabel, tone } = normalityVerdict(result, threshold)
  const warningText = result?.warnings.join(' ') || undefined

  return (
    <div className="normality-side">
      <span className="normality-side-label">{label}</span>
      <span className={`normality-badge normality-badge-${tone}`} title={warningText}>
        {verdictLabel}
      </span>
      <span className="normality-stat">
        {result?.statistic !== null && result?.statistic !== undefined ? `stat = ${result.statistic.toFixed(4)}` : 'stat = -'},{' '}
        {formatPValue(result?.pValue ?? null)}
      </span>
      {warningText ? <span className="normality-warning-caption">{warningText}</span> : null}
    </div>
  )
}
