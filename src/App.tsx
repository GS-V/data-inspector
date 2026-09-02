import { useEffect, useState } from 'react'
import { ActionToolbar } from './components/ActionToolbar'
import { FileLoader } from './components/FileLoader'
import { Icon, IconSprite } from './components/Icon'
import { InspectionTools } from './components/InspectionTools'
import { InspectorChart } from './components/InspectorChart'
import { InspectorControls } from './components/InspectorControls'
import { SelectionTable } from './components/SelectionTable'
import { useDataInspectorStore } from './store/useDataInspectorStore'
import './App.css'

type ThemeMode = 'light' | 'dark'

function getInitialTheme(): ThemeMode {
  const savedTheme = localStorage.getItem('data-inspector-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return 'dark'
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const workbook = useDataInspectorStore((state) => state.workbook)
  const auditLogLength = useDataInspectorStore((state) => state.auditLog.length)
  const undoLastActionGroup = useDataInspectorStore((state) => state.undoLastActionGroup)
  const hasUnsavedWork = Boolean(workbook && auditLogLength > 0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('data-inspector-theme', theme)
  }, [theme])

  // Cmd/Ctrl+Z calls the same undoLastActionGroup the "Undo last action" button calls.
  // The store has no redo stack yet. Cmd/Ctrl+Shift+Z therefore logs a warning, so the
  // shortcut is neither silently swallowed nor left unbound.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) {
        return
      }

      // Let text fields keep native undo/redo (the New Value input, the reason note).
      // Hijacking it there would cost the user their in-progress typing.
      const tag = event.target instanceof HTMLElement ? event.target.tagName : ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return
      }

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undoLastActionGroup()
        return
      }

      if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault()
        console.warn('Redo is not implemented yet -- wire this shortcut to a redo action once one exists.')
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undoLastActionGroup])

  useEffect(() => {
    if (!hasUnsavedWork) {
      return
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedWork])

  return (
    <main className="app-shell">
      <IconSprite />
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>Data Inspector</h1>
            <p>Explore your data. Detect issues. Clean with confidence.</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-file" title={workbook?.fileName ?? 'No file opened'}>
            <span>{workbook?.fileName ?? 'No file opened'}</span>
            <span aria-hidden="true">□</span>
          </div>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            <Icon name="sun" />
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="left-column">
          <FileLoader />
          <section className="panel guidance-panel">
            <details>
              <summary>How this works</summary>
              <ol>
                <li>Load a CSV or Excel file.</li>
                <li>Choose a sheet and value column.</li>
                <li>Preview values that need review using the detection tools.</li>
                <li>Select cells in the table or chart.</li>
                <li>Highlight, blank, replace, or fill selected values.</li>
                <li>Apply a column transform and check normality, if needed.</li>
                <li>Enable "Require reason" to record a note with each change.</li>
                <li>Generate a Python or R script that reproduces your cleaned data.</li>
                <li>Export cleaned data, the audit log, or a QC report.</li>
                <li>Save your session to a file and restore it later.</li>
              </ol>
              <p className="guidance-subsection">
                <strong>Compare columns</strong>
                Select additional numeric columns to overlay on the same chart.
                Each column uses a distinct colour with a legend entry.
                Comparison columns are for visualisation only — all cleaning,
                transform, and statistics tools operate on the primary column.
                Not available in Density, CDF, Q-Q, or Table view.
              </p>
              <p className="guidance-subsection">
                <strong>Code generation</strong>
                Click "Generate code" in the Export section to produce a Python
                or R script. The script reproduces the final cleaned state.
                Undone actions are excluded automatically.
              </p>
            </details>
          </section>
          <InspectorControls />
          <InspectionTools />
          <section className="panel guidance-panel privacy-panel">
            <details>
              <summary>Privacy & safety</summary>
              <ul>
                <li>Files stay in your browser. Nothing is uploaded.</li>
                <li>Large files may be rejected for browser safety.</li>
                <li>Export your cleaned file, audit log, or QC report before closing.</li>
              </ul>
            </details>
          </section>
        </div>

        <div className="main-column">
          <InspectorChart theme={theme} />
          <SelectionTable />
        </div>

        <ActionToolbar />
      </div>
    </main>
  )
}

export default App
