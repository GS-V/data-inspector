import type { CellId, CellState, SheetData, TransformationType } from '../types/data'
import { getVisibleColumnValues } from './chartData'

export type TransformParams = {
  useOffset?: boolean
  lambda?: number
  mean?: number
  sd?: number
}

function applyLog(value: number, useOffset?: boolean): number | null {
  const input = useOffset ? value + 1 : value
  if (input <= 0) {
    return null
  }
  return Math.log(input)
}

function applyLog10(value: number, useOffset?: boolean): number | null {
  const input = useOffset ? value + 1 : value
  if (input <= 0) {
    return null
  }
  return Math.log10(input)
}

function applySqrt(value: number): number | null {
  if (value <= 0) {
    return null
  }
  return Math.sqrt(value)
}

function applyBoxCox(value: number, lambda: number): number | null {
  if (value <= 0) {
    return null
  }
  return lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda
}

function applyZScore(value: number, mean?: number, sd?: number): number | null {
  if (mean === undefined || sd === undefined || sd === 0) {
    return null
  }
  return (value - mean) / sd
}

/** Dispatches to the transform matching `type`. Returns null when the input is out of domain. */
export function transformValue(value: number, type: TransformationType, params?: TransformParams): number | null {
  switch (type) {
    case 'log':
      return applyLog(value, params?.useOffset)
    case 'log10':
      return applyLog10(value, params?.useOffset)
    case 'sqrt':
      return applySqrt(value)
    case 'boxcox':
      return applyBoxCox(value, params?.lambda ?? 1)
    case 'zscore':
      return applyZScore(value, params?.mean, params?.sd)
    default:
      return null
  }
}

export type TransformFeasibility = {
  feasible: boolean
  zeroNegativeCount: number
  issues: string[]
}

/** Checks whether a transform can run on the given values, ignoring any +1 offset remedy. */
export function validateTransformFeasibility(values: number[], type: TransformationType): TransformFeasibility {
  if (type === 'zscore') {
    if (values.length < 2) {
      return {
        feasible: false,
        zeroNegativeCount: 0,
        issues: ['At least two numeric values are needed to compute a z-score.'],
      }
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    if (Math.sqrt(variance) === 0) {
      return {
        feasible: false,
        zeroNegativeCount: 0,
        issues: ['All values are identical; z-score is undefined.'],
      }
    }

    return { feasible: true, zeroNegativeCount: 0, issues: [] }
  }

  const zeroNegativeCount = values.filter((value) => value <= 0).length
  const issues =
    zeroNegativeCount > 0
      ? [`${zeroNegativeCount} value${zeroNegativeCount === 1 ? '' : 's'} are zero or negative and cannot be transformed directly.`]
      : []

  return { feasible: zeroNegativeCount === 0, zeroNegativeCount, issues }
}

const ALTERNATIVE_TRANSFORMS: Record<TransformationType, TransformationType[]> = {
  log: ['log10', 'zscore'],
  log10: ['log', 'zscore'],
  sqrt: ['boxcox', 'zscore'],
  boxcox: ['sqrt', 'zscore'],
  zscore: ['log', 'sqrt'],
}

/** Alternative transform types to suggest when the requested one is infeasible. */
export function suggestAlternativeTransforms(type: TransformationType): TransformationType[] {
  return ALTERNATIVE_TRANSFORMS[type]
}

/** Adjusted Fisher-Pearson standardized moment coefficient (sample skewness). */
export function calculateSkewness(values: number[]): number | null {
  const n = values.length
  if (n < 3) {
    return null
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)
  if (sd === 0) {
    return 0
  }

  const sumCubed = values.reduce((sum, value) => sum + ((value - mean) / sd) ** 3, 0)
  return (n / ((n - 1) * (n - 2))) * sumCubed
}

/** Grid search over lambda in [-2, 2] step 0.05, minimizing |skewness| of the Box-Cox result. */
export function estimateOptimalBoxCoxLambda(values: number[]): number {
  const positiveValues = values.filter((value) => value > 0)
  if (positiveValues.length < 3) {
    return 1
  }

  let bestLambda = 1
  let bestScore = Infinity

  for (let step = -40; step <= 40; step += 1) {
    const lambda = Math.round(step * 0.05 * 100) / 100
    const transformed = positiveValues.map((value) => (lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda))
    const skewness = calculateSkewness(transformed)
    if (skewness === null) {
      continue
    }

    const score = Math.abs(skewness)
    if (score < bestScore) {
      bestScore = score
      bestLambda = lambda
    }
  }

  return bestLambda
}

/** Coarse histogram bucket counts, used to draw a sparkline thumbnail. */
export function computeSparkbucket(values: number[], bucketCount = 12): number[] {
  const buckets = new Array(bucketCount).fill(0)
  if (values.length === 0) {
    return buckets
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    buckets[Math.floor(bucketCount / 2)] = values.length
    return buckets
  }

  const span = max - min
  values.forEach((value) => {
    const index = Math.min(bucketCount - 1, Math.floor(((value - min) / span) * bucketCount))
    buckets[index] += 1
  })

  return buckets
}

/** Convenience wrapper reusing chartData's cellState-aware value filter for plain numeric arrays. */
export function getColumnNumericValues(
  sheet: SheetData,
  columnName: string,
  cellState: Record<CellId, CellState>,
): number[] {
  return getVisibleColumnValues(sheet, columnName, cellState).map((entry) => entry.value)
}
