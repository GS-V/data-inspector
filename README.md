# Visual Data Inspector

A browser-based tool for human-in-the-loop review, cleaning, and quality
control of tabular data. Load a CSV or multi-sheet Excel file, inspect
distributions, flag outliers, apply transforms, blank or replace bad values,
and export clean and audit outputs — all without writing any code.

## What this is

Visual Data Inspector is designed for researchers and analysts who need to
review data manually before it enters a pipeline. It supports iterative,
undoable editing with a full audit trail so every change is traceable.

## Features

### Data loading
- CSV and multi-sheet Excel (.xlsx) files
- Sheet switcher for workbooks with multiple tabs
- Preserves original data — edits are tracked separately

### Visualization
- **Table** — interactive data grid with windowed rendering, Excel-style
  multi-cell selection (click, drag, Shift+click, Ctrl/Cmd+click), and
  frozen row/column headers
- **Histogram** — distribution with configurable bins
- **Box plot / Violin** — spread and density per column
- **Scatter** — column vs column with highlight overlay
- **Time series** — date-indexed line chart

### Outlier detection
- Preview values outside the typical range (IQR-based)
- Preview duplicate rows
- Z-score cutoff filter — flag values N standard deviations from the mean
- Value range filter — greater than / less than / between

### Highlight marking
- Flag for review (yellow), mark as problem (red), mark as accepted (green),
  custom color
- Marks are non-destructive — original values are preserved
- Remove highlight to unmark

### Normalization & transforms
- Log (configurable base: 2, 10, natural, or any value)
- Z-score standardization
- Square root
- Full transform history with replay

### Normality testing
- Shapiro-Wilk and D'Agostino-Pearson tests run on the active column

### Cleaning
- Replace selected values with a new value
- Blank selected values
- Fill missing values: column mean, column median, or linear interpolation
- Undo last action
- Optional reason prompt — toggle on to require a reason before each
  blank or replace action; the reason is saved to the audit log

### Audit log
- Every change recorded: timestamp, action type, column, row identity,
  old value, new value, and optional reason
- Session-grouped view in the Audit log panel
- Export as CSV for external review

### Export
- **Clean CSV** — data with blanked values removed, ready for downstream use
- **Marked CSV** — full data with a status column added (Blanked, Review,
  Problem, Accepted, Imputed)
- **Audit CSV** — complete change log with all fields

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
- Multi-sheet workbooks preserve the original sheet structure
- Audit CSV columns: Timestamp, Action, Action Detail, Column, Sheet,
  Row/Identity, Row #, Old Value, New Value, Reason, Method, Group ID

## Development

Stack: React + Vite + TypeScript, Zustand for state, no backend.
