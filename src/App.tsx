import { useEffect, useState } from 'react'
import { ActionToolbar } from './components/ActionToolbar'
import { FileLoader } from './components/FileLoader'
import { InspectionTools } from './components/InspectionTools'
import { InspectorChart } from './components/InspectorChart'
import { InspectorControls } from './components/InspectorControls'
import { SelectionTable } from './components/SelectionTable'
import './App.css'

type ThemeMode = 'light' | 'dark'

function getInitialTheme(): ThemeMode {
  const savedTheme = localStorage.getItem('data-inspector-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('data-inspector-theme', theme)
  }, [theme])

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Data Inspector</h1>
          <p>Open a spreadsheet. See what looks unusual. Mark it. Clean it. Export it.</p>
        </div>
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </header>

      <FileLoader />

      <div className="workspace-grid">
        <div className="left-column">
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
