import { mkdtempSync, rmSync, statSync, createWriteStream, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import Papa from 'papaparse'

const MB = 1024 * 1024
const TARGETS_MB = [5, 25, 50]
const HEADER = 'Plot,Yield,NDVI,Height,Moisture,Notes\n'

function rowFor(index) {
  const plot = index + 1
  const yieldValue = (20 + (index % 100) * 0.25).toFixed(2)
  const ndvi = (0.35 + (index % 50) / 100).toFixed(3)
  const height = (45 + (index % 80) * 0.4).toFixed(1)
  const moisture = (10 + (index % 40) * 0.2).toFixed(1)
  const note = index % 250 === 0 ? 'review candidate' : 'normal'
  return `${plot},${yieldValue},${ndvi},${height},${moisture},${note}\n`
}

async function writeSyntheticCsv(filePath, targetBytes) {
  const stream = createWriteStream(filePath)
  let written = Buffer.byteLength(HEADER)
  let rowIndex = 0
  stream.write(HEADER)

  while (written < targetBytes) {
    const row = rowFor(rowIndex)
    written += Buffer.byteLength(row)
    if (!stream.write(row)) {
      await new Promise((resolve) => stream.once('drain', resolve))
    }
    rowIndex += 1
  }

  await new Promise((resolve) => stream.end(resolve))
  return rowIndex
}

function parseCsvFile(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const start = performance.now()
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  const elapsedMs = performance.now() - start
  return {
    elapsedMs,
    rows: parsed.data.length,
    columns: parsed.meta.fields?.length ?? 0,
    errors: parsed.errors.length,
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'data-inspector-capacity-'))

try {
  console.log('capacity-check: synthetic CSV parse check')
  console.log('capacity-check: files are temporary and will be removed')

  for (const targetMb of TARGETS_MB) {
    const filePath = join(tempDir, `synthetic-${targetMb}mb.csv`)
    const writtenRows = await writeSyntheticCsv(filePath, targetMb * MB)
    const sizeMb = statSync(filePath).size / MB
    const result = parseCsvFile(filePath)
    console.log(
      [
        `target=${targetMb} MB`,
        `actual=${sizeMb.toFixed(1)} MB`,
        `rows=${result.rows.toLocaleString()}`,
        `columns=${result.columns}`,
        `parseMs=${Math.round(result.elapsedMs).toLocaleString()}`,
        `errors=${result.errors}`,
        `generatedRows=${writtenRows.toLocaleString()}`,
      ].join(' | '),
    )
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
  console.log('capacity-check: temporary files removed')
}
