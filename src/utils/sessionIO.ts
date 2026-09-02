/*
 * Write the whole workspace state to a JSON session file and read one back.
 * Pure apart from the download, which it delegates to downloadBlob in exportCsv.ts.
 * parseSessionFile never throws, so a caller can treat any unreadable input as a rejected file.
 */
import { downloadBlob } from './exportCsv'
import type { SessionFile } from '../types/data'

/**
 * Download the session as data-inspector-<file stem>-<save date>.json.
 * The file stem and date make one file per source file per day easy to pick out of a downloads
 * folder. Reuse downloadBlob rather than building an anchor here, so session files and CSV
 * exports share one object-URL lifecycle and one revoke.
 */
export function exportSession(session: SessionFile): void {
  const json = JSON.stringify(session, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const stem = session.sourceFileName.replace(/\.[^.]+$/, '')
  const date = new Date(session.savedAt).toISOString().slice(0, 10)
  downloadBlob(`data-inspector-${stem}-${date}.json`, blob)
}

/**
 * Parse a session file, or return null when the text is not one.
 * A version of exactly 1 and a non-empty sourceFileName are the minimum sanity check. They
 * separate a real session file from arbitrary JSON a user picked by mistake.
 * Return null instead of throwing, because the caller is a file input that must show a message
 * rather than break the session already loaded.
 */
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
