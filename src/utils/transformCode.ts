import type { TransformAttempt } from '../types/data'

function formatNumberForCode(value: number): string {
  return String(Number(value.toFixed(6)))
}

function escapePythonString(column: string): string {
  return column.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

const R_IDENTIFIER = /^[A-Za-z.][A-Za-z0-9._]*$/

function rColumnRef(column: string): string {
  return R_IDENTIFIER.test(column) ? `df$${column}` : `df$\`${column.replace(/`/g, '\\`')}\``
}

function pythonColumnRef(column: string): string {
  return `df['${escapePythonString(column)}']`
}

function pythonLine(entry: TransformAttempt, column: string): string {
  const col = pythonColumnRef(column)
  switch (entry.type) {
    case 'log':
      return entry.useOffset ? `${col} = np.log(${col} + 1)` : `${col} = np.log(${col})`
    case 'log10':
      return entry.useOffset ? `${col} = np.log10(${col} + 1)` : `${col} = np.log10(${col})`
    case 'sqrt':
      return `${col} = np.sqrt(${col})`
    case 'boxcox': {
      const lambda = entry.lambda ?? 1
      if (lambda === 0) {
        return `${col} = np.log(${col})`
      }
      return `${col} = (${col} ** ${formatNumberForCode(lambda)} - 1) / ${formatNumberForCode(lambda)}`
    }
    case 'zscore': {
      const mean = formatNumberForCode(entry.statsBefore.mean ?? 0)
      const sd = formatNumberForCode(entry.statsBefore.standardDeviation ?? 1)
      return `${col} = (${col} - ${mean}) / ${sd}`
    }
  }
}

function rLine(entry: TransformAttempt, column: string): string {
  const col = rColumnRef(column)
  switch (entry.type) {
    case 'log':
      return entry.useOffset ? `${col} <- log(${col} + 1)` : `${col} <- log(${col})`
    case 'log10':
      return entry.useOffset ? `${col} <- log10(${col} + 1)` : `${col} <- log10(${col})`
    case 'sqrt':
      return `${col} <- sqrt(${col})`
    case 'boxcox': {
      const lambda = entry.lambda ?? 1
      if (lambda === 0) {
        return `${col} <- log(${col})`
      }
      return `${col} <- (${col}^${formatNumberForCode(lambda)} - 1) / ${formatNumberForCode(lambda)}`
    }
    case 'zscore': {
      const mean = formatNumberForCode(entry.statsBefore.mean ?? 0)
      const sd = formatNumberForCode(entry.statsBefore.standardDeviation ?? 1)
      return `${col} <- (${col} - ${mean}) / ${sd}`
    }
  }
}

/**
 * One pandas assignment line per transformed column. For multi-column batch transforms,
 * z-score's mean/SD come from statsBefore, which is computed across all columns in the batch
 * combined -- not recomputed per column -- so a multi-column z-score snippet reuses the same
 * (mean, sd) pair on every line rather than each column's own statistics.
 */
export function transformToPython(entry: TransformAttempt): string {
  return entry.columns.map((column) => pythonLine(entry, column)).join('\n')
}

/** Same caveat as transformToPython: multi-column z-score reuses the batch-level mean/SD. */
export function transformToR(entry: TransformAttempt): string {
  return entry.columns.map((column) => rLine(entry, column)).join('\n')
}
