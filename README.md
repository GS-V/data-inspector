# Visual Data Inspector

A browser-based tool for human-in-the-loop review, cleaning, and quality
control of tabular data. Load a CSV or multi-sheet Excel file, inspect
distributions, flag outliers, apply transforms, blank or replace bad values,
and export clean and audit outputs — all without writing any code.

## What this is

Visual Data Inspector is designed for researchers and analysts who need to
review data manually before it enters a pipeline. It supports iterative,
undoable editing with a full audit trail so every change is traceable and
reproducible.

## Features

### Data loading
- CSV and multi-sheet Excel (.xlsx) files
- Sheet switcher for workbooks with multiple tabs
- Preserves original data — edits are tracked as an overlay, never written
  back to the source

### Visualization
- **Table** — interactive data grid with windowed rendering, Excel-style
  multi-cell selection (click, drag, Shift+click, Ctrl/Cmd+click), frozen
  headers, and live highlight overlay
- **Scatter** — column vs column with optional date X-axis and multi-column
  comparison overlay (up to 4 columns)
- **Histogram** — distribution with configurable bins
- **Box plot** — spread and quartiles per column
- **Violin** — density + spread combined
- **Q-Q plot** — normality check vs theoretical quantiles
- **Density (KDE)** — kernel density estimate
- **Cumulative distribution (CDF)**

### Outlier and quality review
- IQR-based outlier preview (Tukey's fence, configurable multiplier)
- Duplicate value detection
- Z-score cutoff filter — flag values N standard deviations from the mean
- Value range filter — flag values greater than / less than / between bounds
- All previews are non-destructive; act or discard independently

### Highlight marking
- Flag for review (yellow), problem (red), accepted (green), or custom color
- Marks are non-destructive; original values are preserved
- Clear marks individually or in bulk

### Normalization and transforms
- **Log** — natural log or any base (2, 10, e, or custom); optional +1 offset
  for zero-containing data
- **Square root** — moderate right-skew correction
- **Box-Cox** — grid-searches λ from −2 to 2 to minimize skewness; λ
  displayed and used in generated code
- **Z-score** — rescale to mean 0 / SD 1 (sample SD, ddof=1)
- Transform history panel shows before/after distribution stats, skewness,
  sparkline histograms, and normality test results
- Applies to the active column or multiple comparison columns simultaneously

### Normality testing
- **Shapiro-Wilk** — Royston 1995 approximation, validated n 3–5000
- **Jarque-Bera** — asymptotic chi-squared test (JB statistic, biased moments)
- **Anderson-Darling** — D'Agostino & Stephens case 3 (mean/variance unknown)
- Configurable significance threshold; pass/fail verdict shown inline and in
  the QC report

### Data cleaning
- Replace selected values with a new value
- Blank selected, previewed, problem-marked, or review-marked values
- Fill missing values: column mean, column median, or linear interpolation
- **Undo last action** (Cmd/Ctrl+Z or toolbar button) — full group undo;
  reversal is recorded in the audit log
- **Require reason** toggle — when on, every blank/replace/fill action opens
  a reason dialog before applying; reason is saved to the audit log

### Session save and restore
- Save the full session state to a `.json` file: all edits, marks, transform
  history, undo stack, and UI preferences
- Restore a session on top of a reloaded workbook — the raw data stays in the
  file; the session carries the overlay
- Filename mismatch warning with force-restore option

### Code generation
- **Generate code** button opens a modal with a Python or R script that
  exactly reproduces the current cleaned state
- Includes: cell blanking, value replacements, imputed fills, and all active
  transforms (Box-Cox, log, z-score, sqrt) in the order they were applied
- Undone transforms are automatically excluded — the script reflects the
  final state, not the full edit history
- Normality test results appear as comments above each transform block
- Download as `.py` or `.R`, or copy to clipboard
- Python: pandas + numpy, 0-based row indexing
- R: readxl, 1-based row indexing, `sd()` default (ddof=1)

### QC report
- Per-sheet, per-column summary: count, missing, mean, SD, skewness, blanked,
  imputed, transforms applied, normality verdict
- Export as PDF (via browser print) or CSV

### Audit log
- Every change recorded: timestamp, action type, sheet, column, row identity,
  old value, new value, method, reason (if provided), and group ID
- Undo entries reference the original action type
- View grouped by session in the Audit log panel
- Export as CSV

### Export
- **Cleaned data** — active sheet as CSV, or full workbook as XLSX with
  highlight colors preserved
- **Audit log** — complete change history as CSV
- Configurable output filename

## Quick start

```bash
npm install
npm run dev        # development server at localhost:5173
```

Production build:

```bash
docker compose up --build    # serves at localhost:3000
```

## File format notes

- Excel exports are UTF-8 with BOM for correct rendering in Windows Excel
- Multi-sheet XLSX exports preserve all sheets with highlight overlays
- Audit CSV columns: Timestamp, Action, Action Detail, Column, Sheet,
  Row/Identity, Row #, Old Value, New Value, Reason, Method, Group ID

## Development

Stack: React + Vite + TypeScript, Zustand for state, Plotly.js for charts,
no backend. All data processing runs in the browser.

```
src/
  components/   UI components (ActionToolbar, CodeModal, QcReportModal, …)
  store/        Zustand store — single source of truth for all edit state
  types/        Shared TypeScript types (WorkbookData, CellState, AuditAction, …)
  utils/        Pure utilities: parsing, transforms, exports, code generation
```

Key design invariants:
- Raw workbook rows are never mutated; all edits live in `cellState` (an
  overlay keyed by cell ID)
- `undoStack` holds action groups; undo pops the last group and appends
  reversal entries to `auditLog`
- `transformHistory` is append-only — entries are never removed on undo;
  code generation detects live vs. undone transforms by cross-referencing
  `undoStack` group IDs
