import { useMemo, useState } from 'react'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { AuditAction, AuditActionType } from '../types/data'
import { actionLabel } from '../utils/auditReason'

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function actionIcon(actionType: AuditActionType): { icon: string; css: string } {
  switch (actionType) {
    case 'mark_review': return { icon: '⚑', css: 'audit-icon-review' }
    case 'mark_problem': return { icon: '△', css: 'audit-icon-problem' }
    case 'mark_keep': return { icon: '✓', css: 'audit-icon-keep' }
    case 'mark_custom': return { icon: '◇', css: 'audit-icon-custom' }
    case 'clear_mark': return { icon: '×', css: 'audit-icon-clear' }
    case 'blank_selected':
    case 'blank_problem':
    case 'blank_review': return { icon: '□', css: 'audit-icon-blank' }
    case 'replace_value': return { icon: '↔', css: 'audit-icon-replace' }
    case 'transform_log': return { icon: 'ℓ', css: 'audit-icon-transform' }
    case 'transform_log10': return { icon: 'ℓ', css: 'audit-icon-transform' }
    case 'transform_sqrt': return { icon: '√', css: 'audit-icon-transform' }
    case 'transform_boxcox': return { icon: 'λ', css: 'audit-icon-transform' }
    case 'transform_zscore': return { icon: 'z', css: 'audit-icon-transform' }
    case 'undo': return { icon: '↶', css: 'audit-icon-undo' }
    default: return { icon: '•', css: '' }
  }
}

function isHighlight(actionType: AuditActionType): boolean {
  return ['mark_review', 'mark_problem', 'mark_keep', 'mark_custom', 'clear_mark'].includes(actionType)
}

type ColumnGroup = {
  key: string
  columnName: string
  sheetName: string
  actions: AuditAction[]
  flagCount: number
  blankCount: number
  problemCount: number
  keepCount: number
  replaceCount: number
}

function buildGroups(auditLog: AuditAction[]): ColumnGroup[] {
  const order: string[] = []
  const map = new Map<string, ColumnGroup>()

  auditLog.forEach((action) => {
    if (action.actionType === 'undo') return
    const key = `${action.sheetName}::${action.columnName}`
    if (!map.has(key)) {
      order.push(key)
      map.set(key, {
        key,
        columnName: action.columnName,
        sheetName: action.sheetName,
        actions: [],
        flagCount: 0,
        blankCount: 0,
        problemCount: 0,
        keepCount: 0,
        replaceCount: 0,
      })
    }
    const group = map.get(key)!
    group.actions.push(action)
    if (action.actionType === 'mark_review') group.flagCount++
    if (action.actionType === 'mark_problem') group.problemCount++
    if (action.actionType === 'mark_keep') group.keepCount++
    if (['blank_selected', 'blank_problem', 'blank_review'].includes(action.actionType)) group.blankCount++
    if (action.actionType === 'replace_value') group.replaceCount++
  })

  return order.map((k) => map.get(k)!)
}

function matchesSearch(action: AuditAction, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    action.columnName.toLowerCase().includes(q) ||
    action.sheetName.toLowerCase().includes(q) ||
    (action.reasonCategory ?? '').toLowerCase().includes(q) ||
    (action.reasonNote ?? '').toLowerCase().includes(q) ||
    action.rowIdentifier.toLowerCase().includes(q)
  )
}

export function AuditLogPanel({ onExport }: { onExport: () => void }) {
  const auditLog = useDataInspectorStore((s) => s.auditLog)
  const [search, setSearch] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (!search) return auditLog
    return auditLog.filter((a) => matchesSearch(a, search))
  }, [auditLog, search])

  const groups = useMemo(() => buildGroups(filtered), [filtered])

  const sessionStats = useMemo(() => {
    const nonUndo = auditLog.filter((a) => a.actionType !== 'undo')
    return {
      total: nonUndo.length,
      columns: new Set(nonUndo.map((a) => `${a.sheetName}::${a.columnName}`)).size,
      flagged: nonUndo.filter((a) => isHighlight(a.actionType) && a.actionType !== 'clear_mark').length,
      blanked: nonUndo.filter((a) => ['blank_selected', 'blank_problem', 'blank_review'].includes(a.actionType)).length,
    }
  }, [auditLog])

  function toggleGroup(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  if (auditLog.length === 0) {
    return (
      <div className="audit-empty">
        <span className="button-icon" aria-hidden="true">▤</span>
        <p>No changes recorded yet.</p>
        <p className="hint">Flag, highlight, or blank values to build the audit log.</p>
      </div>
    )
  }

  return (
    <div className="audit-log-panel">
      <div className="audit-session-summary">
        <div className="audit-stat-cell">
          <strong>{sessionStats.total}</strong>
          <span>Actions</span>
        </div>
        <div className="audit-stat-cell">
          <strong>{sessionStats.columns}</strong>
          <span>Columns</span>
        </div>
        <div className="audit-stat-cell">
          <strong>{sessionStats.flagged}</strong>
          <span>Flagged</span>
        </div>
        <div className="audit-stat-cell">
          <strong>{sessionStats.blanked}</strong>
          <span>Blanked</span>
        </div>
      </div>

      <div className="audit-search-bar">
        <span className="button-icon" aria-hidden="true">⌕</span>
        <input
          type="text"
          placeholder="Filter by column, reason, or identity…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter audit log"
        />
        {search && (
          <button
            type="button"
            className="audit-search-clear"
            onClick={() => setSearch('')}
            aria-label="Clear filter"
          >
            ×
          </button>
        )}
      </div>

      {groups.length === 0 && (
        <div className="audit-empty">
          <p className="hint">No entries match your filter.</p>
        </div>
      )}

      <div className="audit-groups">
        {groups.map((group) => {
          const isOpen = expandedKeys.has(group.key)
          return (
            <div key={group.key} className="audit-col-group">
              <button
                type="button"
                className="audit-col-header"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={isOpen}
              >
                <span className="audit-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="audit-col-name">{group.columnName}</span>
                <span className="audit-sheet-badge">{group.sheetName}</span>
                <span className="audit-col-pills">
                  {group.flagCount > 0 && <span className="audit-pill audit-pill-review">{group.flagCount} flagged</span>}
                  {group.problemCount > 0 && <span className="audit-pill audit-pill-problem">{group.problemCount} problem</span>}
                  {group.keepCount > 0 && <span className="audit-pill audit-pill-keep">{group.keepCount} accepted</span>}
                  {group.blankCount > 0 && <span className="audit-pill audit-pill-blank">{group.blankCount} blanked</span>}
                  {group.replaceCount > 0 && <span className="audit-pill audit-pill-replace">{group.replaceCount} replaced</span>}
                </span>
              </button>

              {isOpen && (
                <div className="audit-action-list">
                  {group.actions.map((action) => {
                    const { icon, css } = actionIcon(action.actionType)
                    return (
                      <div key={action.id} className="audit-action-row">
                        <span className={`audit-entry-icon ${css}`} aria-hidden="true">{icon}</span>
                        <div className="audit-entry-id">
                          <strong>{action.rowIdentifier}</strong>
                        </div>
                        <div className="audit-entry-detail">
                          <span>{actionLabel(action.actionType, action.newValue)}</span>
                          {(action.reasonCategory || action.reasonNote) && (
                            <span className="audit-entry-reason">
                              {action.reasonCategory && <strong>{action.reasonCategory}</strong>}
                              {action.reasonCategory && action.reasonNote && ' — '}
                              {action.reasonNote && `"${action.reasonNote}"`}
                            </span>
                          )}
                          {action.methodContext && (
                            <span className="audit-entry-method">{action.methodContext}</span>
                          )}
                        </div>
                        <span className="audit-entry-time">{formatTimestamp(action.timestamp)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="audit-footer">
        <button
          type="button"
          className="audit-export-btn"
          onClick={onExport}
          disabled={auditLog.length === 0}
          title="Export audit log as CSV"
        >
          <span className="button-icon" aria-hidden="true">⇩</span>
          Export CSV
        </button>
      </div>
    </div>
  )
}
