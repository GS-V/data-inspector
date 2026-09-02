/*
 * Generate the per-transform code snippet behind each "Copy as code" button in
 * TransformHistoryPanel. This module renders one TransformAttempt entry only.
 * generateScript.ts is the separate generator that emits a full script for the whole session.
 * Pure functions -- no React, no Zustand, no clipboard access. The caller copies the string.
 */
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
    case 'log10': {
      const base = entry.base ?? 10
      if (base === 10) {
        return entry.useOffset ? `${col} = np.log10(${col} + 1)` : `${col} = np.log10(${col})`
      }
      const baseCode = formatNumberForCode(base)
      return entry.useOffset
        ? `${col} = np.log(${col} + 1) / np.log(${baseCode})`
        : `${col} = np.log(${col}) / np.log(${baseCode})`
    }
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
    case 'log10': {
      const base = entry.base ?? 10
      if (base === 10) {
        return entry.useOffset ? `${col} <- log10(${col} + 1)` : `${col} <- log10(${col})`
      }
      const baseCode = formatNumberForCode(base)
      return entry.useOffset
        ? `${col} <- log(${col} + 1, base = ${baseCode})`
        : `${col} <- log(${col}, base = ${baseCode})`
    }
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
 * Return one pandas assignment line per transformed column.
 * A z-score line inlines entry.statsBefore.mean and entry.statsBefore.standardDeviation. For a
 * multi-column batch those two numbers cover every column in the batch combined. They are not
 * recomputed per column, so each line of a multi-column z-score snippet reuses the same pair.
 * The snippet is therefore an approximation meant for display. generateScript.ts emits .mean()
 * and .std(ddof=1) calls instead, so the two generators do not produce identical z-score code.
 */
export function transformToPython(entry: TransformAttempt): string {
  return entry.columns.map((column) => pythonLine(entry, column)).join('\n')
}

/**
 * Return one R assignment line per transformed column.
 * The same z-score caveat as transformToPython applies. A multi-column batch reuses the
 * batch-level mean and SD, and generateScript.ts emits mean() and sd() calls instead.
 */
export function transformToR(entry: TransformAttempt): string {
  return entry.columns.map((column) => rLine(entry, column)).join('\n')
}
