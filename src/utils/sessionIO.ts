import { downloadBlob } from './exportCsv'
import type { SessionFile } from '../types/data'

export function exportSession(session: SessionFile): void {
  const json = JSON.stringify(session, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const stem = session.sourceFileName.replace(/\.[^.]+$/, '')
  const date = new Date(session.savedAt).toISOString().slice(0, 10)
  downloadBlob(`data-inspector-${stem}-${date}.json`, blob)
}

export function parseSessionFile(raw: string): SessionFile | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== 1 ||
      typeof (parsed as Record<string, unknown>).sourceFileName !== 'string' ||
      !(parsed as Record<string, unknown>).sourceFileName
    ) {
      return null
    }
    return parsed as SessionFile
  } catch {
    return null
  }
}
