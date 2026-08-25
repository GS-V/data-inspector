# Data Inspector

## What this is

Data Inspector is a browser-based tool for inspecting and cleaning tabular data before analysis. It's built for lab researchers, students, and interns doing data QC on field trial and vegetation index datasets in CSV and Excel format — flagging outliers, filling gaps, transforming skewed columns, and exporting a clean file alongside a full audit trail of every change.

## Features

- CSV and multi-sheet Excel file loading
- Column inspection with descriptive statistics (min, max, mean, median, stdDev)
- Interactive chart view: scatter, histogram, KDE, Q-Q, CDF
- Normality testing: Shapiro-Wilk, Jarque-Bera, Anderson-Darling
- Transform pipeline with audit trail, undo, and Python/R code export:
  natural log, Normalize (log base X, Z-score), sqrt, Box-Cox
- Row-level actions with undo: mark, blank, replace
- Threshold highlighting for outlier review
- Fill missing values: mean, median, interpolate
- Audit log panel: full session-grouped change history with row identity
  and expandable detail
- Export: CSV (active sheet), XLSX (workbook with highlights),
  Audit log (full history as CSV)

## Quick start

```bash
docker compose up --build
open http://localhost:3000
```

## Export modes

- **CSV** exports the active sheet only: values only, no highlight colors, with blanked/replaced values applied.
- **XLSX** exports the full workbook, including highlight colors, with blanked/replaced values applied.
- **Audit log** exports the complete change history as its own CSV: sheet, row, column, old/new value, method, and reason for every action.

## Development

```bash
npm install
npm run dev
```
