import type { TransformationType } from '../types/data'
import type { IconName } from '../components/Icon'

export const TRANSFORM_INFO: Record<TransformationType, { label: string; effect: string; math: string; icon: IconName }> = {
  log: {
    label: 'Natural Log',
    effect: 'Compresses a long right tail (values must be > 0)',
    math: 'y = ln(x), requires x > 0. Best for strongly right-skewed data where the spread grows with magnitude (lognormal-shaped distributions).',
    icon: 'compress',
  },
  log10: {
    label: 'Log (base 10)',
    effect: 'Same idea as natural log, on a base-10 scale',
    math: 'y = log₁₀(x) = ln(x) / ln(10). Same compression and the same x > 0 requirement as natural log — only the numeric scale of the result differs, not which values pass or how the shape changes.',
    icon: 'compress',
  },
  sqrt: {
    label: 'Square Root',
    effect: 'Softens moderate right-skew, gentler than log',
    math: 'y = √x, requires x ≥ 0. Compresses large values less aggressively than log — under-corrects strong skew, but a safer default when skew is only mild.',
    icon: 'soften',
  },
  boxcox: {
    label: 'Box-Cox',
    effect: 'Auto-finds the power transform closest to normal',
    math: 'y = (x^λ − 1) / λ for λ ≠ 0, or y = ln(x) when λ = 0. "Auto-pick the best exponent" runs a grid search over λ from −2 to 2 in 0.05 steps and keeps the value whose transformed skewness is closest to zero.',
    icon: 'auto',
  },
  zscore: {
    label: 'Z-Score',
    effect: 'Rescales to mean 0, SD 1 — for comparing columns',
    math: 'y = (x − mean) / SD. Rescales only — mean and SD become 0 and 1 by construction, but the shape of the distribution is unchanged (unlike the other four transforms, which do change shape).',
    icon: 'bell',
  },
}
