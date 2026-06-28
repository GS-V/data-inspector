import { useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import { assessFileLoadRisk } from '../utils/fileRisk'
import { parseLocalFile } from '../utils/fileParsers'

export function FileLoader() {
  const workbook = useDataInspectorStore((state) => state.workbook)
  const setWorkbook = useDataInspectorStore((state) => state.setWorkbook)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [loadedFileSize, setLoadedFileSize] = useState('')
  const [isLoading, setIsLoading] = useState(false)

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

  return (
    <section className="file-loader">
      <div>
        <label className="file-picker">
          <span className="button-icon" aria-hidden="true">⇧</span>
          <span>Open CSV or XLSX</span>
          <span className="file-caret" aria-hidden="true">⌄</span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
        </label>
        <p className="privacy-note">
          Files stay in this browser. Nothing is uploaded.
          <InfoTip label="Large files may be rejected for browser safety. Export your cleaned file when you are done." />
        </p>
      </div>
      <div className="file-status">
        {isLoading ? <span className="muted">Reading file...</span> : null}
        {workbook && loadedFileSize ? <span className="muted">Loaded size: {loadedFileSize}</span> : null}
        {warning ? <span className="warning-text">{warning}</span> : null}
        {workbook?.parseWarnings?.length ? (
          <span className="warning-text">
            Loaded with {workbook.parseWarnings.length} CSV warning
            {workbook.parseWarnings.length === 1 ? '' : 's'}.
          </span>
        ) : null}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </section>
  )
}
