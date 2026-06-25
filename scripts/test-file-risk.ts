import assert from 'node:assert/strict'
import { assessFileLoadRisk } from '../src/utils/fileRisk.ts'

const MB = 1024 * 1024
const GB = 1024 * MB

type Case = {
  name: string
  input: Parameters<typeof assessFileLoadRisk>[0]
  expectedTier: ReturnType<typeof assessFileLoadRisk>['tier']
}

const cases: Case[] = [
  {
    name: 'small CSV is safe',
    input: { name: 'small.csv', size: 10 * MB },
    expectedTier: 'safe',
  },
  {
    name: '100 MB CSV warns',
    input: { name: 'medium.csv', size: 100 * MB },
    expectedTier: 'warning',
  },
  {
    name: '300 MB CSV is high-risk',
    input: { name: 'large.csv', size: 300 * MB },
    expectedTier: 'high-risk',
  },
  {
    name: '600 MB CSV is rejected',
    input: { name: 'too-large.csv', size: 600 * MB },
    expectedTier: 'reject',
  },
  {
    name: 'small XLSX is safe',
    input: { name: 'small.xlsx', size: 10 * MB },
    expectedTier: 'safe',
  },
  {
    name: '80 MB XLSX is high-risk',
    input: { name: 'large.xlsx', size: 80 * MB },
    expectedTier: 'high-risk',
  },
  {
    name: '150 MB XLSX is rejected',
    input: { name: 'too-large.xlsx', size: 150 * MB },
    expectedTier: 'reject',
  },
  {
    name: '4 GB CSV is rejected',
    input: { name: 'multi-gb.csv', size: 4 * GB },
    expectedTier: 'reject',
  },
  {
    name: 'unknown file type is rejected',
    input: { name: 'notes.txt', size: 10 * MB },
    expectedTier: 'reject',
  },
  {
    name: 'low-memory device gets stricter CSV tier',
    input: { name: 'low-memory.csv', size: 40 * MB, deviceMemoryGb: 4 },
    expectedTier: 'warning',
  },
  {
    name: 'high-memory device keeps normal CSV tier',
    input: { name: 'high-memory.csv', size: 40 * MB, deviceMemoryGb: 16 },
    expectedTier: 'safe',
  },
]

cases.forEach((testCase) => {
  const actual = assessFileLoadRisk(testCase.input)
  assert.equal(actual.tier, testCase.expectedTier, testCase.name)
})

console.log(`file-risk: ${cases.length} checks passed`)
