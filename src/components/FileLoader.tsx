import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { InfoTip } from './InfoTip'
import { ModalPortal } from './ModalPortal'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { SessionFile } from '../types/data'
import { assessFileLoadRisk } from '../utils/fileRisk'
import { parseLocalFile } from '../utils/fileParsers'
import { parseSessionFile } from '../utils/sessionIO'

export function FileLoader() {
  const workbook = useDataInspectorStore((state) => state.workbook)
  const setWorkbook = useDataInspectorStore((state) => state.setWorkbook)
  const auditLog = useDataInspectorStore((state) => state.auditLog)
  const saveSession = useDataInspectorStore((state) => state.saveSession)
  const restoreSession = useDataInspectorStore((state) => state.restoreSession)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [loadedFileSize, setLoadedFileSize] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<
    { kind: 'saved' | 'restored' | 'error'; message: string } | null
  >(null)
  const [pendingSession, setPendingSession] = useState<SessionFile | null>(null)
  const sessionFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!sessionStatus) return
    const timer = setTimeout(() => setSessionStatus(null), 3000)
    return () => clearTimeout(timer)
  }, [sessionStatus])

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setError('')
    setWarning('')

    const deviceMemoryGb =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
        : undefined
    const risk = assessFileLoadRisk({
      name: file.name,
      size: file.size,
      type: file.type,
      deviceMemoryGb,
    })

    if (risk.tier === 'reject') {
      setError(`${risk.title}: ${risk.message} Size: ${risk.fileSizeLabel}. ${risk.nextSteps}`)
      event.target.value = ''
      return
    }

    if (risk.requiresConfirmation) {
      const shouldContinue = window.confirm(
        `${risk.title}\n\n${risk.message}\n\nFile size: ${risk.fileSizeLabel}\n\n${risk.nextSteps}\n\nFiles stay in this browser. Nothing is uploaded.`,
      )
      if (!shouldContinue) {
        setWarning(`Canceled loading ${file.name}. Current session was preserved.`)
        event.target.value = ''
        return
      }
      setWarning(`${risk.title}: ${risk.fileSizeLabel}. Loading may be slow.`)
    }

    setIsLoading(true)
    try {
      const parsedWorkbook = await parseLocalFile(file)
      setWorkbook(parsedWorkbook)
      setLoadedFileSize(risk.fileSizeLabel)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'File could not be opened.')
    } finally {
      setIsLoading(false)
      event.target.value = ''
    }
  }

  async function handleSessionFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const raw = await file.text()
    const session = parseSessionFile(raw)

    if (!session) {
      setSessionStatus({ kind: 'error', message: 'Invalid or unrecognized session file.' })
      return
    }

    const result = restoreSession(session)
    if (result.warnings.length > 0) {
      setPendingSession(session)
      return
    }

    const editCount = Object.keys(session.cellState).length
    setSessionStatus({
      kind: 'restored',
      message: `Session restored — ${session.auditLog.length} actions, ${editCount} edits`,
    })
  }

  return (
    <section className="file-loader">
      <div>
        <label className="file-picker">
          <Icon name="folder-open" />
          <span>Open CSV or XLSX</span>
          <span className="file-caret">
            <Icon name="chevron-down" className="file-caret-icon" />
          </span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
        </label>
        <p className="privacy-note">
          Files stay in this browser. Nothing is uploaded.
          <InfoTip label="Large files may be rejected for browser safety. Export your cleaned file when you are done." />
        </p>
        <div className="session-controls">
          <button
            className="session-btn"
            onClick={() => {
              saveSession()
              setSessionStatus({ kind: 'saved', message: 'Session saved' })
            }}
            disabled={!workbook || auditLog.length === 0}
            title="Save session to a JSON file you can restore later"
          >
            <Icon name="download" />
            Save session
          </button>

          <button
            className="session-btn"
            onClick={() => sessionFileInputRef.current?.click()}
            disabled={!workbook}
            title="Restore a previously saved session"
          >
            <Icon name="upload" />
            Restore session
          </button>

          <input
            ref={sessionFileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleSessionFileChange}
          />
        </div>
        {pendingSession && (
          <ModalPortal onBackdropClick={() => setPendingSession(null)}>
            <div className="session-confirm-dialog">
              <p>{`Session was saved for "${pendingSession.sourceFileName}".`}</p>
              <p>{`Current file is "${workbook?.fileName ?? ''}". Restore anyway?`}</p>
              <div className="session-confirm-buttons">
                <button onClick={() => setPendingSession(null)}>Cancel</button>
                <button
                  className="session-confirm-primary"
                  onClick={() => {
                    restoreSession(pendingSession, { force: true })
                    const editCount = Object.keys(pendingSession.cellState).length
                    setSessionStatus({
                      kind: 'restored',
                      message: `Session restored — ${pendingSession.auditLog.length} actions, ${editCount} edits`,
                    })
                    setPendingSession(null)
                  }}
                >
                  Restore anyway
                </button>
              </div>
            </div>
          </ModalPortal>
        )}
      </div>
      <div className="file-status">
        {isLoading ? (
          <span className="muted file-loading-status">
            <span className="spinner" aria-hidden="true" />
            Reading file...
          </span>
        ) : null}
        {workbook && loadedFileSize ? <span className="muted">Loaded size: {loadedFileSize}</span> : null}
        {warning ? <span className="warning-text">{warning}</span> : null}
        {workbook?.parseWarnings?.length ? (
          <span className="warning-text">
            Loaded with {workbook.parseWarnings.length} CSV warning
            {workbook.parseWarnings.length === 1 ? '' : 's'}.
          </span>
        ) : null}
        {error ? <span className="error-text">{error}</span> : null}
        {sessionStatus && (
          <span className={sessionStatus.kind === 'error' ? 'error-text' : 'muted'}>
            {sessionStatus.message}
          </span>
        )}
      </div>
    </section>
  )
}
