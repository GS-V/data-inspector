import assert from 'node:assert/strict'
import type { TransformAttempt } from '../src/types/data.ts'
import { transformToPython, transformToR } from '../src/utils/transformCode.ts'

function makeAttempt(overrides: Partial<TransformAttempt>): TransformAttempt {
  return {
    id: 'transform-1',
    type: 'log',
    sheetName: 'Sheet1',
    columns: ['Yield'],
    appliedAt: '2026-01-01T00:00:00.000Z',
    statsBefore: {
      count: 3,
      missingCount: 0,
      mean: 42.7,
      median: 40,
      min: 10,
      q1: 20,
      q3: 60,
      max: 70,
      iqr: 40,
      standardDeviation: 12.5,
    },
    statsAfter: {
      count: 3,
      missingCount: 0,
      mean: 3.7,
      median: 3.6,
      min: 2.3,
      q1: 3,
      q3: 4.1,
      max: 4.2,
      iqr: 1.1,
      standardDeviation: 0.6,
    },
    skewnessBefore: 1.2,
    skewnessAfter: 0.1,
    sparkBefore: [],
    sparkAfter: [],
    normalityTestType: 'shapiro-wilk',
    normalityThreshold: 0.05,
    normalityBefore: null,
    normalityAfter: null,
    ...overrides,
  }
}

// log, no offset
assert.equal(transformToPython(makeAttempt({ type: 'log', useOffset: false })), "df['Yield'] = np.log(df['Yield'])")
assert.equal(transformToR(makeAttempt({ type: 'log', useOffset: false })), 'df$Yield <- log(df$Yield)')

// log, with +1 offset
assert.equal(transformToPython(makeAttempt({ type: 'log', useOffset: true })), "df['Yield'] = np.log(df['Yield'] + 1)")
assert.equal(transformToR(makeAttempt({ type: 'log', useOffset: true })), 'df$Yield <- log(df$Yield + 1)')

// log10
assert.equal(transformToPython(makeAttempt({ type: 'log10', useOffset: false })), "df['Yield'] = np.log10(df['Yield'])")
assert.equal(transformToR(makeAttempt({ type: 'log10', useOffset: true })), 'df$Yield <- log10(df$Yield + 1)')

// sqrt
assert.equal(transformToPython(makeAttempt({ type: 'sqrt' })), "df['Yield'] = np.sqrt(df['Yield'])")
assert.equal(transformToR(makeAttempt({ type: 'sqrt' })), 'df$Yield <- sqrt(df$Yield)')

// Box-Cox, lambda != 0
assert.equal(
  transformToPython(makeAttempt({ type: 'boxcox', lambda: 0.5 })),
  "df['Yield'] = (df['Yield'] ** 0.5 - 1) / 0.5",
)
assert.equal(transformToR(makeAttempt({ type: 'boxcox', lambda: 0.5 })), 'df$Yield <- (df$Yield^0.5 - 1) / 0.5')

// Box-Cox, lambda == 0 special case matches transforms.ts's own branching
assert.equal(transformToPython(makeAttempt({ type: 'boxcox', lambda: 0 })), "df['Yield'] = np.log(df['Yield'])")
assert.equal(transformToR(makeAttempt({ type: 'boxcox', lambda: 0 })), 'df$Yield <- log(df$Yield)')

// z-score uses the actual mean/SD recorded on the attempt
assert.equal(
  transformToPython(makeAttempt({ type: 'zscore' })),
  "df['Yield'] = (df['Yield'] - 42.7) / 12.5",
)
assert.equal(transformToR(makeAttempt({ type: 'zscore' })), 'df$Yield <- (df$Yield - 42.7) / 12.5')

// Multi-column batch: one line per column, not one combined line.
const multiColumn = makeAttempt({ type: 'sqrt', columns: ['Yield', 'NDVI'] })
assert.equal(transformToPython(multiColumn), "df['Yield'] = np.sqrt(df['Yield'])\ndf['NDVI'] = np.sqrt(df['NDVI'])")
assert.equal(transformToR(multiColumn), 'df$Yield <- sqrt(df$Yield)\ndf$NDVI <- sqrt(df$NDVI)')

// Column names that aren't valid bare identifiers are quoted/backticked safely.
const spacedColumn = makeAttempt({ type: 'sqrt', columns: ["Plot O'Brien"] })
assert.equal(transformToPython(spacedColumn), "df['Plot O\\'Brien'] = np.sqrt(df['Plot O\\'Brien'])")
assert.equal(transformToR(spacedColumn), "df$`Plot O'Brien` <- sqrt(df$`Plot O'Brien`)")

console.log('transform-code: checks passed')
