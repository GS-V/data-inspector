// Temporary verification script for the correlation functions in src/utils/stats.ts.
// Loads the real source (no copy): slices the correlation section out of stats.ts, strips its
// TypeScript types with Node's built-in stripper, and imports it as a data: URL module.
// The section is self-contained -- it uses no imports from the rest of the file.
// Run: node scripts/test-correlation.mjs
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = readFileSync(new URL('../src/utils/stats.ts', import.meta.url), 'utf8')
const start = source.lastIndexOf('/*', source.indexOf(' * Pearson r for two numeric arrays.'))
const js = stripTypeScriptTypes(source.slice(start))
const { pearsonR, spearmanR, kendallTauB, buildCorrelationMatrix } = await import(
  `data:text/javascript,${encodeURIComponent(js)}`
)

// "prompt" = the expected value given in the verification request.
// "scipy"  = recomputed with scipy.stats 1.13.1 (pearsonr / spearmanr / kendalltau).
// They disagree for several cases; both are checked and reported.
const cases = []
function check(label, actual, prompt, scipy) {
  cases.push({ label, actual, prompt, scipy })
}

const A = [[1, 2, 3, 4, 5], [2, 4, 5, 4, 5]]
check('A pearsonR', pearsonR(...A), 0.9035079, 0.7745966692)
check('A spearmanR', spearmanR(...A), 0.8207826, 0.7378647874)
check('A kendallTauB', kendallTauB(...A), 0.7378647, 0.6708203932)

const B = [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]
check('B pearsonR', pearsonR(...B), -1, -1)
check('B spearmanR', spearmanR(...B), -1, -1)
check('B kendallTauB', kendallTauB(...B), -1, -1)

const C = [[1, 2, 3, 4, 5], [3, 3, 3, 3, 3]]
check('C pearsonR', pearsonR(...C), NaN, NaN)
check('C spearmanR', spearmanR(...C), NaN, NaN)
check('C kendallTauB', kendallTauB(...C), NaN, NaN)

const D = [[1, 2, null, 4, 5], [null, 4, 5, 4, 5]]
check('D pearsonR', pearsonR(...D), 0.8660254, 0.755928946)
check('D spearmanR', spearmanR(...D), 0.8660254, 0.8660254038)
check('D kendallTauB', kendallTauB(...D), 0.8164965, 0.8164965809)

const E = [[1, 1, 2, 3], [1, 1, 2, 3]]
check('E kendallTauB', kendallTauB(...E), 1, 1)

const F = [[1, null, null, null, null], [2, null, null, null, null]]
check('F pearsonR', pearsonR(...F), NaN, NaN)
check('F spearmanR', spearmanR(...F), NaN, NaN)
check('F kendallTauB', kendallTauB(...F), NaN, NaN)

const { labels, matrix } = buildCorrelationMatrix(
  [
    { name: 'A', values: [1, 2, 3, 4, 5] },
    { name: 'B', values: [2, 4, 5, 4, 5] },
    { name: 'C', values: [5, 4, 3, 2, 1] },
  ],
  'pearson',
)
check('matrix labels = A,B,C', labels.join(',') === 'A,B,C' ? 1 : 0, 1, 1)
check('matrix[0][0]', matrix[0][0], 1, 1)
check('matrix[1][1]', matrix[1][1], 1, 1)
check('matrix[2][2]', matrix[2][2], 1, 1)
check('matrix[0][1]', matrix[0][1], 0.9035, 0.7745966692)
check('matrix[1][0]', matrix[1][0], 0.9035, 0.7745966692)
check('matrix[0][2]', matrix[0][2], -1, -1)
check('matrix[2][0]', matrix[2][0], -1, -1)
check('matrix[1][2]', matrix[1][2], -0.7844645, -0.7745966692)
check('matrix[2][1]', matrix[2][1], -0.7844645, -0.7745966692)
check('symmetric [0][1] === [1][0]', matrix[0][1] === matrix[1][0] ? 1 : 0, 1, 1)
check('symmetric [1][2] === [2][1]', matrix[1][2] === matrix[2][1] ? 1 : 0, 1, 1)
check('symmetric [0][2] === [2][0]', matrix[0][2] === matrix[2][0] ? 1 : 0, 1, 1)
check('matrix[1][2] === pearsonR(B, C)', matrix[1][2] === pearsonR([2, 4, 5, 4, 5], [5, 4, 3, 2, 1]) ? 1 : 0, 1, 1)

// The prompt's matrix[0][1] is given to 4 dp only, so compare it at 1e-4; everything else 1e-6.
function matches(actual, expected, label) {
  if (Number.isNaN(expected)) return Number.isNaN(actual)
  const tolerance = /matrix\[(0\]\[1|1\]\[0)\]/.test(label) && expected === 0.9035 ? 1e-4 : 1e-6
  return Math.abs(actual - expected) < tolerance
}

let promptPass = 0
let scipyPass = 0
for (const { label, actual, prompt, scipy } of cases) {
  const vsPrompt = matches(actual, prompt, label)
  const vsScipy = matches(actual, scipy, label)
  promptPass += vsPrompt
  scipyPass += vsScipy
  console.log(
    `${vsPrompt ? 'PASS' : 'FAIL'} (prompt)  ${vsScipy ? 'PASS' : 'FAIL'} (scipy)  ${label.padEnd(34)}` +
      ` actual=${String(actual).padEnd(20)} prompt=${String(prompt).padEnd(11)} scipy=${scipy}`,
  )
}
console.log(`\nvs prompt expectations: ${promptPass}/${cases.length} passed`)
console.log(`vs scipy reference:     ${scipyPass}/${cases.length} passed`)
process.exitCode = scipyPass === cases.length ? 0 : 1
