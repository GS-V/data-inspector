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
const {
  pearsonR,
  spearmanR,
  kendallTauB,
  buildCorrelationMatrix,
  correlationPValue,
  correlationCI,
  kendallPValue,
} = await import(
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

// ─── p-value and CI functions ────────────────────────────────────────────────
// These call the real exported functions from stats.ts (loaded above), not inline copies.
// Expected values: p-values from scipy.stats.t.sf / norm.sf (1.13.1); CIs from the Fisher-z
// formula with 1.96, which scipy's pearsonr().confidence_interval matches to 1e-4. Several
// values in the original request were off (e.g. kendallP(0.5, 40) is 5.52e-6, not 2.64e-4);
// the corrected values are used here.
const statCases = []
function assert(got, expected, tol, label) {
  const pass = typeof expected === 'boolean' ? got === expected : Math.abs(got - expected) <= tol
  statCases.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} got=${String(got).padEnd(22)} expected=${expected}`)
}

assert(correlationPValue(0.997, 40), 0, 1e-10, 'pValue: r≈1 → p≈0 (7.6e-44)')
assert(correlationPValue(0.0, 40), 1.0, 1e-6, 'pValue: r=0 → p=1')
assert(correlationPValue(0.3, 40), 0.0600018, 1e-6, 'pValue: r=0.3 n=40')
assert(correlationPValue(0.3, 10), 0.399691, 1e-6, 'pValue: r=0.3 n=10')
assert(correlationPValue(0.44, 20), 0.0522096, 1e-6, 'pValue: r=0.44 n=20 (normal approx gave 0.038)')
assert(Number.isNaN(correlationPValue(NaN, 40)), true, 0, 'pValue: NaN r → NaN p')
assert(Number.isNaN(correlationPValue(0.3, 3)), true, 0, 'pValue: n<4 → NaN')

const ci1 = correlationCI(0.0, 40)
assert(ci1[0], -0.311515, 1e-5, 'CI: r=0 n=40 lower')
assert(ci1[1], 0.311515, 1e-5, 'CI: r=0 n=40 upper')
const ci2 = correlationCI(0.9, 40)
assert(ci2[0], 0.817753, 1e-5, 'CI pearson: r=0.9 n=40 lower')
assert(ci2[1], 0.946227, 1e-5, 'CI pearson: r=0.9 n=40 upper')
const ci3 = correlationCI(0.9, 10)
assert(ci3[0], 0.623927, 1e-5, 'CI pearson: r=0.9 n=10 lower')
assert(ci3[1], 0.97636, 1e-5, 'CI pearson: r=0.9 n=10 upper')
assert(Number.isNaN(correlationCI(1.0, 40)[0]), true, 0, 'CI: |r|=1 → NaN')
assert(Number.isNaN(correlationCI(0.5, 3)[0]), true, 0, 'CI: n<4 → NaN')

// Spearman: Fisher-z variance (1 + r²/2)/(n-3), Bonett & Wright (2000) -- wider than Pearson.
const ciSp = correlationCI(0.9, 40, 'spearman')
assert(ciSp[0] < ci2[0], true, 0, 'CI spearman lower < pearson lower (wider)')
assert(ciSp[1] > ci2[1], true, 0, 'CI spearman upper > pearson upper (wider)')
assert(ciSp[0], 0.796981, 1e-5, 'CI spearman: r=0.9 n=40 lower')
assert(ciSp[1], 0.952136, 1e-5, 'CI spearman: r=0.9 n=40 upper')
assert(correlationCI(0.9, 40)[0] === correlationCI(0.9, 40, 'pearson')[0], true, 0, "CI: default method is 'pearson'")

// Kendall: tie-free normal approximation, evaluated through erfc.
assert(kendallPValue(0.0, 40), 1.0, 1e-6, 'kendallP: tau=0 → p=1')
assert(kendallPValue(0.5, 40), 5.5222e-6, 1e-8, 'kendallP: tau=0.5 n=40')
assert(kendallPValue(0.3, 40), 0.0064041, 1e-6, 'kendallP: tau=0.3 n=40')
assert(kendallPValue(0.97, 39) > 0, true, 0, 'kendallP: strong tau does not underflow to 0')
assert(Number.isNaN(kendallPValue(NaN, 40)), true, 0, 'kendallP: NaN tau → NaN')

// buildCorrelationMatrix wires the method through to the CI and p-value.
const sx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const sy = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]
const sp = buildCorrelationMatrix([{ name: 'x', values: sx }, { name: 'y', values: sy }], 'spearman').statsMatrix[0][1]
const spCI = correlationCI(sp.r, 10, 'spearman')
assert(sp.n === 10 && sp.ciLow === spCI[0] && sp.ciHigh === spCI[1], true, 0, 'matrix: spearman cell uses spearman CI')
assert(sp.p === correlationPValue(sp.r, 10), true, 0, 'matrix: spearman cell p = correlationPValue')
const kc = buildCorrelationMatrix([{ name: 'x', values: sx }, { name: 'y', values: sy }], 'kendall').statsMatrix[0][1]
assert(Number.isNaN(kc.ciLow) && kc.p === kendallPValue(kc.r, 10), true, 0, 'matrix: kendall cell has no CI, kendall p')

const statPass = statCases.filter(Boolean).length
console.log(`\np-value / CI functions: ${statPass}/${statCases.length} passed`)
process.exitCode = scipyPass === cases.length && statPass === statCases.length ? 0 : 1
