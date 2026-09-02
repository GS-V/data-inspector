import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useDataInspectorStore } from '../store/useDataInspectorStore'
import type { SheetData } from '../types/data'
import { makeCellId } from '../utils/cellId'
import { findNumericColumns, getDisplayValue, getEffectiveValue } from '../utils/numeric'

const ROW_HEIGHT = 28
const MIN_WINDOW_ROWS = 50
const OVERSCAN_ROWS = 15
// Above this many cells in one drag, shift-click, or column-select rectangle, defer the commit.
// The UI then paints a "Selecting..." state first. The scatter chart's lasso-select does the same.
const LARGE_SELECTION_THRESHOLD = 200

type CellPosition = { rowIndex: number; column: string }

type TableViewProps = {
  sheet: SheetData
}

// Module-level rather than component state, and deliberately so.
// InspectorChart's isComputingChart gate keys its "Rendering chart..." state on selectedColumn.
// Any click that changes the active column therefore unmounts and remounts this whole component
// one tick later. Plain useState would reset to null on that fresh mount. Every column switch
// would then lose the anchor and active cell, and with them the keyboard navigation and the
// anchor ring those two drive. Module scope survives the remount.
// This is safe only because the app renders exactly one TableView at a time.
let persistedAnchorCell: CellPosition | null = null
let persistedActiveCell: CellPosition | null = null

/**
 * Show a spreadsheet-style view of the active sheet, with every row and column.
 * Rows are windowed, so only the rows scrolled into view ever render.
 * Selection is an Excel-style rectangle of individual cells, driven by click, drag, shift-click,
 * ctrl-click, and the arrow keys. See handleCellMouseDown below for the full interaction model.
 *
 * The most recently targeted cell sets store.selectedColumn. The scatter chart's Y-axis reads
 * that same field, so every right-panel tool activates for that column: Review, Transform,
 * Cleaning, and Fill.
 * Highlight colors are looked up per row and actual column, never per selected column. A
 * highlight applied earlier to a different column therefore still renders correctly here.
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
  // The cell every shift-click and shift-arrow extension measures from. It stays fixed until a
  // plain click, ctrl-click, column-header click, row-number click, or Escape moves it.
  // It initializes from the module-level cache above, so a mid-session remount resumes rather
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

  // Mirrors `dragPreview` so the mouseup handler below can read it synchronously.
  // Never call a store action such as toggleSelectedCell or addSelectedCells from inside a
  // setState functional updater. React may run that updater during another component's render.
  // That logs "Cannot update a component while rendering a different component", and it can
  // drop the store update silently.
  // Reading the pending rectangle from a ref keeps the store call a plain side effect in the
  // event handler body, outside any updater callback.
  const dragStateRef = useRef<{ anchor: CellPosition; current: CellPosition } | null>(null)

  // Whether the pointer has reached a different cell since mousedown. The finishDrag closure
  // below reads it synchronously.
  // The `isDragging` state variable cannot serve here. finishDrag is created once, at mousedown,
  // and closes over whatever `isDragging` held at that render. Later mouseenter updates never
  // change what that closure sees. A ref reads the current value whenever it was created.
  const hasMovedRef = useRef(false)

  // Deferred by one tick so a brief spinner can paint before the initial windowed render runs,
  // which is slow on a large sheet. This uses the same key comparison as the chart's
  // isComputingChart gate. A plain boolean would instead need a synchronous setState inside the
  // effect body to reset it on a sheet change.
  const [readyForSheet, setReadyForSheet] = useState<string | null>(null)
  const isReady = readyForSheet === sheet.name

  useEffect(() => {
    if (readyForSheet === sheet.name) {
      return
    }
    const timeout = window.setTimeout(() => setReadyForSheet(sheet.name), 0)
    return () => window.clearTimeout(timeout)
  }, [sheet.name, readyForSheet])

  // The module-level cache above can carry an anchor or active cell naming a previous sheet's
  // column onto this sheet. Drop both, and cancel any in-flight drag, whenever the active sheet
  // genuinely changes.
  // The ref guard is essential. A [sheet.name] dependency array alone cannot tell "sheet.name
  // changed since the last render" from "this is a fresh mount". This component remounts far
  // more often than the user switches sheets, once for every swap by InspectorChart's
  // isComputingChart gate. That gate keys on selectedColumn and has nothing to do with sheets.
  // Without the guard, each incidental remount would erase the state the cache just restored.
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
      hasMovedRef.current = false
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

  // Which original row indexes are visible, in original order. Hiding blanked rows drops
  // entries here and never renumbers them, so the "#" column always shows a row's true position
  // in the sheet. The unfiltered SelectionTable numbers its rows the same way.
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

  // Return the visible row indexes between two row indexes, inclusive. "Visible" applies the
  // same hideBlanked filtering the column-header full-column select already respects.
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

  // Attach the mouseup listener here, synchronously inside the mousedown handler. Do not move
  // it to a useEffect keyed on `isDragging`. Such an effect runs only after React commits the
  // re-render that follows setIsDragging(true). A fast programmatic click fires mouseup right
  // after mousedown, with no real time between them. The browser can then dispatch mouseup
  // before that effect registers its listener, and the click is dropped silently.
  // Adding the listener in the mousedown handler guarantees it exists before mouseup can fire.
  //
  // A note on focus. A <td> is not focusable, so the browser's default mousedown handling blurs
  // whatever held focus, such as the Plot Type <select>, back to <body>. The keydown handler's
  // input, select, and textarea guard further down needs exactly that to let arrow keys through.
  // This is native default behavior. Nothing here has to request it.
  function handleCellMouseDown(rowIndex: number, column: string, event: React.MouseEvent) {
    if (!column) {
      return
    }

    if (event.shiftKey && anchorCell) {
      // Shift-click extends the rectangle from the fixed anchor to the clicked cell, then
      // merges it into the existing selection. The anchor's column stays active, so the column
      // of the first clicked cell remains the active one.
      const cellIds = rectangleCellIds(anchorCell.rowIndex, rowIndex, anchorCell.column, column)
      commitCellIds(cellIds, { additive: true })
      setActiveCell({ rowIndex, column })
      return
    }

    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd-click toggles one cell into or out of the existing selection. It starts no drag
      // and clears nothing. preserveSelection keeps cells already selected in other columns,
      // even though the active column moves to the cell just clicked.
      if (column !== selectedColumn) {
        setSelectedColumn(column, { preserveSelection: true })
      }
      toggleSelectedCell(makeCellId(sheet.name, rowIndex, column))
      setAnchorCell({ rowIndex, column })
      setActiveCell({ rowIndex, column })
      return
    }

    // A plain click, and the start of a plain drag, clear the previous selection at mousedown.
    // A zero-distance drag is a simple click. Clearing here makes both it and a real drag
    // replace the old selection rather than accumulate onto it.
    if (column !== selectedColumn) {
      setSelectedColumn(column)
    }
    clearPreview()
    clearSelection()

    // A drag shows nothing until the pointer reaches a different cell: no crosshair cursor, no
    // rectangle preview, and no suppressed text selection. See handleCellMouseEnter below.
    // A plain click that never moves stays a single-cell selection.
    const start = { rowIndex, column }
    setAnchorCell(start)
    setActiveCell(start)
    hasMovedRef.current = false
    dragStateRef.current = { anchor: start, current: start }

    function finishDrag() {
      window.removeEventListener('mouseup', finishDrag)
      setIsDragging(false)
      setDragPreview(null)

      const dragState = dragStateRef.current
      const moved = hasMovedRef.current
      dragStateRef.current = null
      hasMovedRef.current = false
      if (!dragState) {
        return
      }
      // Mousedown above already cleared the selection, so add the final rectangle rather than
      // replace again. Replacing here would drop every cell but the last one dragged over.
      // If the pointer never left the origin cell, this rectangle holds only that cell.
      const cellIds = moved
        ? rectangleCellIds(
            dragState.anchor.rowIndex,
            dragState.current.rowIndex,
            dragState.anchor.column,
            dragState.current.column,
          )
        : [makeCellId(sheet.name, dragState.anchor.rowIndex, dragState.anchor.column)]
      commitCellIds(cellIds, { additive: true })
      setActiveCell(dragState.current)
    }

    // Attach to window rather than the table, so a mouse release outside the table still
    // commits the drag and clears isDragging. Otherwise a pointer that leaves the grid before
    // the button comes up leaves the drag stuck open.
    window.addEventListener('mouseup', finishDrag)
  }

  // Cell-level rather than row-level, so the live rectangle preview tracks both the row and the
  // column under the cursor. It fires on mouseenter rather than mousemove, for performance.
  // Each <td> below binds it directly, never a parent wrapper. It then fires for every cell the
  // pointer sweeps into during a drag, instead of once for the whole table.
  function handleCellMouseEnter(rowIndex: number, column: string) {
    const dragState = dragStateRef.current
    if (!dragState) {
      return
    }
    dragState.current = { rowIndex, column }
    if (!hasMovedRef.current) {
      if (rowIndex === dragState.anchor.rowIndex && column === dragState.anchor.column) {
        return
      }
      hasMovedRef.current = true
      setIsDragging(true)
    }
    setDragPreview({ anchor: dragState.anchor, current: dragState.current })
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
        // Leave the arrow keys and Escape alone while the user types elsewhere in the app,
        // such as in the reason-prompt modal or the replacement-value field.
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
        // Recompute the whole rectangle from the fixed anchor every time. Holding shift and an
        // arrow key then grows or shrinks the selection, rather than stacking rectangles.
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
          Virtualization uses two spacer <tr> elements, never position: absolute plus a
          transform on the table. Native `position: sticky` headers and the frozen row-number
          column depend on it: a transform on any ancestor of a sticky element creates a new
          containing block, which breaks stickiness against the real scroll viewport.
        */}
        <table className={`data-grid-table${isDragging ? ' data-grid-dragging' : ''}`}>
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
              // A row takes the full-row highlight only once every one of its cells is
              // selected. A partial selection highlights just the matching <td> elements below.
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
