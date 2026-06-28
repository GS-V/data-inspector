import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { rm } from 'node:fs/promises'
import { build } from 'vite'

const entry = process.argv[2]

if (!entry) {
  console.error('usage: node scripts/run-vite-test.mjs <entry.ts>')
  process.exit(1)
}

const testName = basename(entry).replace(/\.[cm]?tsx?$/, '')
const outDir = `.tmp/${testName}`

await rm(outDir, { recursive: true, force: true })

await build({
  logLevel: 'warn',
  build: {
    ssr: entry,
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'test.js',
      },
    },
  },
})

const result = spawnSync(process.execPath, [`${outDir}/test.js`], { stdio: 'inherit' })
await rm(outDir, { recursive: true, force: true })

process.exit(result.status ?? 1)
