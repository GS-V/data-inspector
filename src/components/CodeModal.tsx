import { useState } from 'react'
import { Icon } from './Icon'
import { ModalPortal } from './ModalPortal'
import { downloadBlob } from '../utils/exportCsv'

type CodeModalProps = {
  pythonScript: string
  rScript: string
  fileName: string
  onClose: () => void
}

/**
 * Show the generated Python and R scripts, with copy and download actions.
 * Both scripts arrive as finished strings. ActionToolbar renders this component only while the
 * modal is open, so it calls the generators exactly once per open. Generating them inside this
 * component would instead re-run both over the whole session state on every tab switch, copy,
 * and download click.
 */
export function CodeModal({ pythonScript, rScript, fileName, onClose }: CodeModalProps) {
  const [lang, setLang] = useState<'python' | 'r'>('python')
  const [copied, setCopied] = useState(false)

  const script = lang === 'python' ? pythonScript : rScript
  const ext = lang === 'python' ? 'py' : 'R'
  const mimeType = lang === 'python' ? 'text/x-python' : 'text/plain'
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'script'

  function handleCopy() {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleDownload() {
    const blob = new Blob([script], { type: mimeType })
    downloadBlob(`${stem}_cleaning_script.${ext}`, blob)
  }

  return (
    <ModalPortal onBackdropClick={onClose}>
      <div className="code-modal" role="dialog" aria-modal="true" aria-labelledby="code-modal-title">
        <div className="code-modal-header">
          <h2 id="code-modal-title">Generated code</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="x-circle" />
          </button>
        </div>
        <div className="code-tab-bar">
          <button
            type="button"
            className={`code-tab${lang === 'python' ? ' code-tab-active' : ''}`}
            onClick={() => setLang('python')}
          >
            Python <span className="code-tab-ext">.py</span>
          </button>
          <button
            type="button"
            className={`code-tab${lang === 'r' ? ' code-tab-active' : ''}`}
            onClick={() => setLang('r')}
          >
            R <span className="code-tab-ext">.R</span>
          </button>
        </div>
        <pre className="code-preview">{script}</pre>
        <div className="code-modal-actions">
          <button type="button" onClick={handleCopy}>
            <Icon name="copy" />
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <button type="button" onClick={handleDownload}>
            <Icon name="download" />
            Download .{ext}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
