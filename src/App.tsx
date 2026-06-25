import { useEffect, useState } from 'react'
import { ActionToolbar } from './components/ActionToolbar'
import { FileLoader } from './components/FileLoader'
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
  const hasUnsavedWork = Boolean(workbook && auditLogLength > 0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('data-inspector-theme', theme)
  }, [theme])

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
            <span aria-hidden="true">☼</span>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="left-column">
          <FileLoader />
          <InspectorControls />
          <InspectionTools />
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
