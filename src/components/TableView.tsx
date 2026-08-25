import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { SheetData } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { findNumericColumns, getDisplayValue, getEffectiveValue } from '../utils/numeric'

const ROW_HEIGHT = 28
const MIN_WINDOW_ROWS = 50
const OVERSCAN_ROWS = 15
// Above this many cells in one drag/shift-click/column-select rectangle, defer the commit (same
// pattern as the scatter chart's lasso-select) so the UI can paint a "Selecting..." state first.
const LARGE_SELECTION_THRESHOLD = 200

type CellPosition = { rowIndex: number; column: string }

type TableViewProps = {
  sheet: SheetData
}

// Module-level, not component state: InspectorChart's own isComputingChart gate (a pre-existing,
// unrelated "Rendering chart..." loading affordance keyed on selectedColumn, out of scope to
// touch here) briefly swaps this whole component out and back in whenever a click changes the
// active column -- a real unmount/remount, one tick later. Plain useState would silently lose
// the anchor/active cell (and the keyboard nav and anchor ring they drive) on every column
// switch, since a fresh mount always re-initializes to null. Module scope survives that remount;
// it's safe here because exactly one TableView is ever rendered at a time in this app.
let persistedAnchorCell: CellPosition | null = null
let persistedActiveCell: CellPosition | null = null

/**
 * Spreadsheet-style view of the active sheet: every row and column, windowed so only the rows
 * scrolled into view are ever rendered. Selection is an Excel-style rectangle of individual
 * cells (click/drag/shift-click/ctrl-click/arrow keys) -- see handleCellMouseDown below for the
 * full interaction model. Whichever cell was most recently targeted sets store.selectedColumn,
 * the same field the scatter chart's Y-axis reads, so every right-panel tool (Review, Transform,
 * Cleaning, Fill) activates for that column. Per-cell highlight colors (mark/blanked/preview) are
 * looked up per (row, actual column), so a highlight from an earlier session on a different
 * column still renders correctly here.
 */
export function TableView({ sheet }: TableViewProps) {
  const {
    selectedColumn,
    setSelectedColumn,
    selectedCells,
    previewCells,
    cellState,
    toggleSelectedCell,
    addSelectedCells,
    clearSelection,
    clearPreview,
    isSelecting,
    setIsSelecting,
  } = useDataInspectorStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(420)
  // The cell a shift-click/shift-arrow extension originates from -- fixed until a plain click,
  // ctrl-click, column-header click, row-number click, or Escape moves it. Initialized from the
  // module-level cache (see its declaration above) so a mid-session remount picks back up rather
  // than resetting to null.
  const [anchorCell, setAnchorCellState] = useState<CellPosition | null>(() => persistedAnchorCell)
  // The most recently targeted single cell -- what arrow keys move from next.
  const [activeCell, setActiveCellState] = useState<CellPosition | null>(() => persistedActiveCell)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPreview, setDragPreview] = useState<{ anchor: CellPosition; current: CellPosition } | null>(null)
  const [hideBlanked, setHideBlanked] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)

  function setAnchorCell(next: CellPosition | null) {
    persistedAnchorCell = next
    setAnchorCellState(next)
  }

  function setActiveCell(next: CellPosition | null) {
    persistedActiveCell = next
    setActiveCellState(next)
  }

  // Mirrors `dragPreview` for synchronous reads in the mouseup handler below. Calling a store
  // action (toggleSelectedCell/addSelectedCells) from inside a setState functional updater is
  // invalid -- React may invoke that updater during another component's render, which both
  // logs "Cannot update a component while rendering a different component" and can silently
  // drop the resulting store update. Reading the pending rectangle from a ref instead keeps the
  // store call a plain side effect in the event handler body, not inside any updater callback.
  const dragStateRef = useRef<{ anchor: CellPosition; current: CellPosition } | null>(null)

  // Deferred by one tick so a brief spinner can paint before the (potentially large) initial
  // windowed render runs -- same key-comparison technique as the chart's isComputingChart gate,
  // used instead of a plain boolean so resetting it on sheet change never calls setState
  // synchronously inside the effect body.
  const [readyForSheet, setReadyForSheet] = useState<string | null>(null)
  const isReady = readyForSheet === sheet.name

  useEffect(() => {
    if (readyForSheet === sheet.name) {
      return
    }
    const timeout = window.setTimeout(() => setReadyForSheet(sheet.name), 0)
    return () => window.clearTimeout(timeout)
  }, [sheet.name, readyForSheet])

  // A stale anchor/active cell naming a previous sheet's column could survive onto this one via
  // the module-level cache above, so drop them (and cancel any in-flight drag) whenever the
  // active sheet genuinely changes. Guarded on a ref, not just the [sheet.name] dependency array,
  // because a dependency array alone can't distinguish "sheet.name changed since last render" from
  // "this is a fresh mount" -- and this component gets fresh-mounted far more often than the user
  // actually switches sheets, every time InspectorChart's own isComputingChart gate (a pre-existing
  // "Rendering chart..." loading affordance, keyed on selectedColumn and unrelated to sheet
  // switching) swaps this component out and back in. Without the guard, that incidental remount's
  // effect-on-mount would immediately erase the very state the module-level cache just restored.
  const previousSheetNameRef = useRef(sheet.name)
  useEffect(() => {
    if (previousSheetNameRef.current === sheet.name) {
      return
    }
    previousSheetNameRef.current = sheet.name
    const timeout = window.setTimeout(() => {
      setAnchorCell(null)
      setActiveCell(null)
      setIsDragging(false)
      setDragPreview(null)
      dragStateRef.current = null
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [sheet.name])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const numericColumns = useMemo(() => new Set(findNumericColumns(sheet.rows, sheet.columns)), [sheet])

  const columnIndexByName = useMemo(() => {
    const map = new Map<string, number>()
    sheet.columns.forEach((column, index) => map.set(column, index))
    return map
  }, [sheet.columns])

  // Which original row indexes are visible, in original order. Hiding blanked rows removes
  // entries here rather than renumbering -- the "#" column always shows a row's true position
  // in the sheet, matching the un-filtered SelectionTable's row numbering convention.
  const rowIndexes = useMemo(() => {
    const allIndexes = sheet.rows.map((_, rowIndex) => rowIndex)
    if (!hideBlanked || !selectedColumn) {
      return allIndexes
    }
    return allIndexes.filter((rowIndex) => {
      const state = cellState[makeCellId(sheet.name, rowIndex, selectedColumn)]
      return state?.valueOverride !== null
    })
  }, [sheet, hideBlanked, selectedColumn, cellState])

  const selectedCount = Object.keys(selectedCells).length

  // Column range between two column names, inclusive, order-independent.
  const getColumnRange = useCallback(
    (columnA: string, columnB: string): string[] => {
      const indexA = columnIndexByName.get(columnA)
      const indexB = columnIndexByName.get(columnB)
      if (indexA === undefined || indexB === undefined) {
        return []
      }
      const lo = Math.min(indexA, indexB)
      const hi = Math.max(indexA, indexB)
      return sheet.columns.slice(lo, hi + 1)
    },
    [columnIndexByName, sheet.columns],
  )

  // Visible row indexes between two row indexes, inclusive -- "visible" matches the same
  // hideBlanked filtering the column-header full-column select already respects.
  const getRowRange = useCallback(
    (rowA: number, rowB: number): number[] => {
      const lo = Math.min(rowA, rowB)
      const hi = Math.max(rowA, rowB)
      return rowIndexes.filter((rowIndex) => rowIndex >= lo && rowIndex <= hi)
    },
    [rowIndexes],
  )

  const rectangleCellIds = useCallback(
    (rowA: number, rowB: number, columnA: string, columnB: string): string[] => {
      const rows = getRowRange(rowA, rowB)
      const columns = getColumnRange(columnA, columnB)
      const cellIds: string[] = []
      for (const rowIndex of rows) {
        for (const column of columns) {
          cellIds.push(makeCellId(sheet.name, rowIndex, column))
        }
      }
      return cellIds
    },
    [getRowRange, getColumnRange, sheet.name],
  )

  function isColumnWithinRange(column: string, columnA: string, columnB: string): boolean {
    const index = columnIndexByName.get(column)
    const indexA = columnIndexByName.get(columnA)
    const indexB = columnIndexByName.get(columnB)
    if (index === undefined || indexA === undefined || indexB === undefined) {
      return false
    }
    return index >= Math.min(indexA, indexB) && index <= Math.max(indexA, indexB)
  }

  function commitCellIds(cellIds: string[], options?: { additive?: boolean }) {
    const commit = () => {
      clearPreview()
      if (!options?.additive) {
        clearSelection()
      }
      addSelectedCells(cellIds)
    }

    if (cellIds.length > LARGE_SELECTION_THRESHOLD) {
      setIsSelecting(true)
      window.setTimeout(() => {
        try {
          commit()
        } finally {
          setIsSelecting(false)
        }
      }, 0)
    } else {
      commit()
    }
  }

  function handleColumnHeaderClick(column: string) {
    if (column !== selectedColumn) {
      setSelectedColumn(column)
    }
    commitCellIds(rowIndexes.map((rowIndex) => makeCellId(sheet.name, rowIndex, column)))
    const firstRowIndex = rowIndexes[0]
    const nextAnchor = firstRowIndex !== undefined ? { rowIndex: firstRowIndex, column } : null
    setAnchorCell(nextAnchor)
    setActiveCell(nextAnchor)
  }

  function handleRowNumberMouseDown(rowIndex: number) {
    // Full-row selection: every column in this row. Active column is left exactly as-is.
    commitCellIds(sheet.columns.map((column) => makeCellId(sheet.name, rowIndex, column)))
    const firstColumn = sheet.columns[0]
    const nextAnchor = firstColumn !== undefined ? { rowIndex, column: firstColumn } : null
    setAnchorCell(nextAnchor)
    setActiveCell(nextAnchor)
  }

  // The mouseup listener is attached here, synchronously inside the mousedown handler, rather
  // than via a useEffect keyed on `isDragging` state. A useEffect only runs after React commits
  // the re-render that follows setIsDragging(true) -- for a fast programmatic click (mousedown
  // immediately followed by mouseup, with no real time between them) the browser can dispatch
  // mouseup before that effect ever registers its listener, silently dropping the click. Adding
  // the listener directly in the mousedown handler guarantees it exists before mouseup can fire.
  //
  // Note on focus: a <td> mousedown isn't itself focusable, so the browser's default mousedown
  // handling blurs whatever was previously focused (e.g. the Plot Type <select>) back to <body>
  // -- exactly what the keydown handler's input/select/textarea guard further down needs to let
  // arrow keys reach it. That's native default behavior; nothing here needs to request it.
  function handleCellMouseDown(rowIndex: number, column: string, event: React.MouseEvent) {
    if (!column) {
      return
    }

    if (event.shiftKey && anchorCell) {
      // Shift-click extends the rectangle from the fixed anchor to the clicked cell and merges
      // it into whatever is already selected -- the anchor's column stays active, matching
      // "keeps the column from the first clicked cell as active."
      const cellIds = rectangleCellIds(anchorCell.rowIndex, rowIndex, anchorCell.column, column)
      commitCellIds(cellIds, { additive: true })
      setActiveCell({ rowIndex, column })
      return
    }

    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd-click toggles just the one cell in/out of the existing selection -- no drag, no
      // clearing. preserveSelection keeps cells already selected in *other* columns intact even
      // though the active column is moving to whichever cell was just clicked.
      if (column !== selectedColumn) {
        setSelectedColumn(column, { preserveSelection: true })
      }
      toggleSelectedCell(makeCellId(sheet.name, rowIndex, column))
      setAnchorCell({ rowIndex, column })
      setActiveCell({ rowIndex, column })
      return
    }

    // Plain click (and the start of a plain drag): clear the previous selection immediately, at
    // mousedown, so a zero-distance drag (a simple click) and a real drag both end up replacing
    // the old selection rather than accumulating onto it.
    if (column !== selectedColumn) {
      setSelectedColumn(column)
    }
    clearPreview()
    clearSelection()

    const start = { rowIndex, column }
    setAnchorCell(start)
    setActiveCell(start)
    setIsDragging(true)
    dragStateRef.current = { anchor: start, current: start }
    setDragPreview(dragStateRef.current)

    function finishDrag() {
      window.removeEventListener('mouseup', finishDrag)
      setIsDragging(false)
      setDragPreview(null)

      const dragState = dragStateRef.current
      dragStateRef.current = null
      if (!dragState) {
        return
      }
      // Selection was already cleared at mousedown above, so the final rectangle is added, not
      // replaced again (replacing here would drop everything but the last cell dragged over).
      const cellIds = rectangleCellIds(
        dragState.anchor.rowIndex,
        dragState.current.rowIndex,
        dragState.anchor.column,
        dragState.current.column,
      )
      commitCellIds(cellIds, { additive: true })
      setActiveCell(dragState.current)
    }

    window.addEventListener('mouseup', finishDrag)
  }

  // Cell-level (not row-level) so the live rectangle preview tracks both the row AND column the
  // cursor is currently over -- updates on mouseenter rather than mousemove for performance.
  function handleCellMouseEnter(rowIndex: number, column: string) {
    if (isDragging && dragStateRef.current) {
      dragStateRef.current = { anchor: dragStateRef.current.anchor, current: { rowIndex, column } }
      setDragPreview(dragStateRef.current)
    }
  }

  function handleClearSelection() {
    if (clearBusy || selectedCount === 0) {
      return
    }
    setClearBusy(true)
    window.setTimeout(() => {
      try {
        clearSelection()
        setAnchorCell(null)
        setActiveCell(null)
      } finally {
        setClearBusy(false)
      }
    }, 0)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const activeTag = document.activeElement instanceof HTMLElement ? document.activeElement.tagName : ''
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
        // Don't hijack arrow keys / Escape while the user is typing somewhere else in the app
        // (the reason-prompt modal, the replacement-value field, etc).
        return
      }

      if (event.key === 'Escape') {
        if (selectedCount > 0) {
          clearSelection()
        }
        setAnchorCell(null)
        setActiveCell(null)
        return
      }

      const deltas: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      }
      const delta = deltas[event.key]
      if (!delta || !activeCell) {
        return
      }

      const columnIndex = columnIndexByName.get(activeCell.column)
      if (columnIndex === undefined) {
        return
      }

      event.preventDefault()
      const [rowDelta, columnDelta] = delta
      const rowPosition = rowIndexes.indexOf(activeCell.rowIndex)
      const nextRowPosition =
        rowDelta !== 0 && rowPosition !== -1
          ? Math.min(Math.max(rowPosition + rowDelta, 0), rowIndexes.length - 1)
          : rowPosition
      const nextRowIndex = nextRowPosition !== -1 ? (rowIndexes[nextRowPosition] ?? activeCell.rowIndex) : activeCell.rowIndex
      const nextColumnIndex = Math.min(Math.max(columnIndex + columnDelta, 0), sheet.columns.length - 1)
      const nextColumn = sheet.columns[nextColumnIndex] ?? activeCell.column
      const nextActiveCell = { rowIndex: nextRowIndex, column: nextColumn }

      if (event.shiftKey && anchorCell) {
        // Recomputes the whole rectangle from the fixed anchor each time, so holding shift+arrow
        // smoothly grows or shrinks the selection instead of accumulating overlapping rectangles.
        const cellIds = rectangleCellIds(anchorCell.rowIndex, nextRowIndex, anchorCell.column, nextColumn)
        clearSelection()
        addSelectedCells(cellIds)
        setActiveCell(nextActiveCell)
        return
      }

      if (nextColumn !== selectedColumn) {
        setSelectedColumn(nextColumn)
      }
      clearPreview()
      clearSelection()
      addSelectedCells([makeCellId(sheet.name, nextRowIndex, nextColumn)])
      setAnchorCell(nextActiveCell)
      setActiveCell(nextActiveCell)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeCell,
    anchorCell,
    columnIndexByName,
    rectangleCellIds,
    rowIndexes,
    sheet,
    selectedColumn,
    selectedCount,
    setSelectedColumn,
    clearPreview,
    clearSelection,
    addSelectedCells,
  ])

  if (!isReady) {
    return (
      <div className="panel-loading-overlay data-grid-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>Loading table…</span>
      </div>
    )
  }

  const totalRows = rowIndexes.length
  const visibleCount = Math.max(MIN_WINDOW_ROWS, Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2)
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const endIndex = Math.min(totalRows, startIndex + visibleCount)
  const visibleRowIndexes = rowIndexes.slice(startIndex, endIndex)
  const columnCount = sheet.columns.length + 1
  const topSpacerHeight = startIndex * ROW_HEIGHT
  const bottomSpacerHeight = (totalRows - endIndex) * ROW_HEIGHT

  return (
    <div className="data-grid-wrap">
      <div className="chart-toolbar">
        <div className="chart-tip">
          Tip: click a cell to select it. Drag, shift-click, or shift+arrow keys for a range. Ctrl/Cmd-click to
          add or remove one cell. Click a column header or row number to select the whole column or row.
        </div>
        <div className="chart-actions">
          {selectedCount > 0 ? (
            <span className="count-chip">
              {isSelecting ? (
                <span className="count-chip-busy">
                  <span className="spinner button-spinner" aria-hidden="true" />
                  Selecting…
                </span>
              ) : (
                <strong>{selectedCount.toLocaleString()} cell{selectedCount === 1 ? '' : 's'} selected</strong>
              )}
            </span>
          ) : null}
          {selectedCount > 0 ? (
            <button type="button" onClick={handleClearSelection} disabled={clearBusy}>
              {clearBusy ? <span className="spinner button-spinner" aria-hidden="true" /> : <Icon name="x-circle" />}
              Clear selection
            </button>
          ) : null}
          <button type="button" onClick={() => setHideBlanked((current) => !current)}>
            <Icon name="eye" />
            {hideBlanked ? 'Show all' : 'Hide blanked'}
          </button>
        </div>
      </div>
      {!selectedColumn ? (
        <p className="hint data-grid-note">No numeric column is selected, so rows can&apos;t be selected in this view.</p>
      ) : null}
      <div
        className="data-grid-scroll table-wrap"
        ref={containerRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {/*
          Virtualization via two spacer <tr> elements (instead of position:absolute + transform
          on the table) so native `position: sticky` headers and the frozen row-number column
          keep working -- a transform on any ancestor of a sticky element creates a new
          containing block and breaks its stickiness relative to the actual scroll viewport.
        */}
        <table className="data-grid-table">
          <thead>
            <tr style={{ height: ROW_HEIGHT }}>
              <th className="data-grid-row-number">#</th>
              {sheet.columns.map((column) => (
                <th
                  key={column}
                  className={`${numericColumns.has(column) ? 'data-grid-align-right' : 'data-grid-align-left'}${
                    column === selectedColumn ? ' data-grid-active-column' : ''
                  }`}
                  onClick={() => handleColumnHeaderClick(column)}
                  title="Click to select this whole column."
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? (
              <tr aria-hidden="true" style={{ height: topSpacerHeight }}>
                <td colSpan={columnCount} className="data-grid-spacer-cell" />
              </tr>
            ) : null}
            {visibleRowIndexes.map((rowIndex) => {
              const row = sheet.rows[rowIndex]
              // A row only gets the full-row highlight once every one of its cells is
              // individually selected -- a partial selection highlights just those <td>s below.
              const isRowFullySelected =
                sheet.columns.length > 0 &&
                sheet.columns.every((column) => Boolean(selectedCells[makeCellId(sheet.name, rowIndex, column)]))

              return (
                <tr
                  key={rowIndex}
                  style={{ height: ROW_HEIGHT }}
                  className={`selectable-row${isRowFullySelected ? ' selected-row' : ''}`}
                >
                  <td
                    className={`data-grid-row-number${isRowFullySelected ? ' selected-cell' : ''}`}
                    onMouseDown={() => handleRowNumberMouseDown(rowIndex)}
                    title="Click to select this whole row."
                  >
                    {rowIndex + 1}
                  </td>
                  {sheet.columns.map((column) => {
                    const cellId = makeCellId(sheet.name, rowIndex, column)
                    const isCellSelected = Boolean(selectedCells[cellId])
                    const isAnchor = Boolean(
                      anchorCell && anchorCell.rowIndex === rowIndex && anchorCell.column === column,
                    )
                    const isDragPreviewCell =
                      dragPreview !== null &&
                      rowIndex >= Math.min(dragPreview.anchor.rowIndex, dragPreview.current.rowIndex) &&
                      rowIndex <= Math.max(dragPreview.anchor.rowIndex, dragPreview.current.rowIndex) &&
                      isColumnWithinRange(column, dragPreview.anchor.column, dragPreview.current.column)
                    const state = cellState[cellId]
                    const isBlanked = state?.valueOverride === null
                    const effectiveValue = getEffectiveValue(row[column], state)
                    const displayValue = isBlanked ? '' : getDisplayValue(effectiveValue)
                    const preview = previewCells[cellId]
                    const markClass = isBlanked
                      ? 'data-grid-mark-blanked'
                      : state?.mark
                        ? `data-grid-mark-${state.mark}`
                        : preview
                          ? 'data-grid-mark-preview'
                          : ''

                    return (
                      <td
                        key={column}
                        className={`${numericColumns.has(column) ? 'data-grid-align-right' : 'data-grid-align-left'} ${markClass}${
                          isCellSelected ? ' selected-cell' : ''
                        }${isAnchor ? ' anchor-cell' : ''}${isDragPreviewCell ? ' data-grid-drag-preview' : ''}`}
                        style={
                          state?.mark === 'custom' && state.highlightColor
                            ? { backgroundColor: state.highlightColor }
                            : undefined
                        }
                        onMouseDown={(event) => handleCellMouseDown(rowIndex, column, event)}
                        onMouseEnter={() => handleCellMouseEnter(rowIndex, column)}
                        title={
                          preview
                            ? `${preview.method}: ${preview.reason}`
                            : 'Click to select. Shift-click, drag, or ctrl/cmd-click for a range or multiple cells.'
                        }
                      >
                        {displayValue}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {bottomSpacerHeight > 0 ? (
              <tr aria-hidden="true" style={{ height: bottomSpacerHeight }}>
                <td colSpan={columnCount} className="data-grid-spacer-cell" />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
