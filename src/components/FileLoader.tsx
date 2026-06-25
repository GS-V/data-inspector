import { useState } from 'react'
import { InfoTip } from './InfoTip'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import { parseLocalFile } from '../utils/fileParsers'

export function FileLoader() {
  const workbook = useDataInspectorStore((state) => state.workbook)
  const setWorkbook = useDataInspectorStore((state) => state.setWorkbook)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setError('')
    setIsLoading(true)
    try {
      const parsedWorkbook = await parseLocalFile(file)
      setWorkbook(parsedWorkbook)
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
          Files are processed locally in your browser. Nothing is uploaded.
          <InfoTip label="Files are processed locally in your browser. Nothing is uploaded." />
        </p>
      </div>
      <div className="file-status">
        {isLoading ? <span className="muted">Reading file...</span> : null}
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
