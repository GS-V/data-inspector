# Data Inspector

Data Inspector is a browser-only, privacy-first visual data inspection tool for CSV and XLSX files.

It helps researchers, students, analysts, and educators open a spreadsheet locally, inspect numeric values, preview values that may need review, apply persistent highlights, blank or replace selected values as cleaned-data overlays, and export cleaned data with an audit trail.

> Files stay in this browser. Nothing is uploaded.

## What It Does

- Opens CSV and XLSX files locally in the browser.
- Supports multi-sheet XLSX workbooks.
- Detects numeric columns while preserving text columns.
- Shows scatter and distribution views for selected value columns.
- Lets users manually select points on the chart.
- Previews values suggested for review, including:
  - outside typical range
  - far from average
  - missing values
  - duplicate values
  - threshold filters
  - expected/domain range checks
  - percentile bounds
- Applies persistent highlights:
  - Flag for review
  - Mark as problem
  - Mark as accepted
  - Custom highlight color
- Supports controlled cleaning overlays:
  - replace selected values with a new value
  - replace selected values with blank
  - replace problem/review values with blank
- Keeps raw imported data unchanged.
- Exports cleaned data and audit logs.
- Warns users before leaving a session with active work.

## Privacy Model

Data Inspector does not use a backend, database, authentication system, or server-side storage.

Uploaded files are parsed in the browser. The app keeps user edits as overlay state instead of modifying the raw imported data.

The app separates:

- **Raw data**: the original imported values.
- **Selection**: temporary active cells selected by the user.
- **Preview**: temporary suggested cells from review tools.
- **Cell state**: persistent highlights, blanked values, replacement values, and notes.
- **Audit log**: action records for review, cleaning, replacement, undo, and export documentation.

## Supported Files

### Input

- `.csv`
- `.xlsx`
- Multi-sheet `.xlsx`

### Export

- CSV data export for the active sheet.
- XLSX workbook export with cleaned values and highlight fills.
- Audit Log CSV as a separate documentation export.

CSV exports are values-only because CSV cannot store colors. XLSX exports preserve highlights where supported.

## Core Workflow

1. Open a CSV or XLSX file.
2. Choose a sheet, value column, X-axis, and plot type.
3. Inspect values visually in the chart.
4. Use preview tools to suggest values for review.
5. Select points manually or from the Review Queue.
6. Apply highlights to document review decisions.
7. Optionally replace or blank selected values.
8. Add reason/category/note context for cleaning decisions.
9. Export cleaned CSV/XLSX data and the Audit Log CSV.

## File-Size Safety

The file loader checks file size before parsing starts. Rejected or canceled files do not replace the current session.

CSV thresholds:

- Up to 50 MB: safe
- Over 50 MB to 250 MB: warning, confirmation required
- Over 250 MB to 500 MB: high-risk, confirmation required
- Over 500 MB: rejected

XLSX thresholds:

- Up to 25 MB: safe
- Over 25 MB to 75 MB: warning, confirmation required
- Over 75 MB to 100 MB: high-risk, confirmation required
- Over 100 MB: rejected

Absolute ceiling:

- Over 1 GB: rejected

On lower-memory devices where `navigator.deviceMemory <= 4`, thresholds are reduced to 75% of the normal values.

## Export Behavior

Data exports preserve the original row and column structure.

CSV export:

- Exports the active sheet only.
- Applies blanked values as empty cells.
- Applies manual replacement values.
- Does not include highlight colors.
- Does not add metadata, audit columns, helper columns, or extra rows.

XLSX export:

- Exports a workbook.
- Preserves sheets where supported.
- Applies blanked values as empty cells.
- Applies manual replacement values.
- Applies highlight fills for review/problem/accepted/custom highlights.
- Does not add audit sheets, metadata sheets, helper columns, or extra rows.

Audit Log CSV:

- Exports action history separately.
- Includes action metadata such as sheet, row, column, old value, new value, method, reason, reason category, and reason note where available.

## Tech Stack

- React
- TypeScript
- Vite
- Zustand
- Papa Parse
- SheetJS `xlsx`
- ExcelJS
- Plotly / react-plotly.js
- ESLint

## Project Structure

```text
src/
  components/          React UI components
  store/               Zustand data inspector state
  types/               Shared TypeScript types
  utils/               Parsing, export, statistics, review checks, file risk
scripts/               Lightweight verification and capacity scripts
docs/                  Project notes and future planning
public/                Static browser assets
```

Important files:

- `src/store/useDataInspectorStore.ts` - main application state and actions.
- `src/components/FileLoader.tsx` - local file loading and file-risk checks.
- `src/components/InspectorChart.tsx` - chart rendering and point interaction.
- `src/components/InspectionTools.tsx` - preview and highlight workflow.
- `src/components/ActionToolbar.tsx` - cleaning, export, and audit actions.
- `src/components/SelectionTable.tsx` - Review Queue.
- `src/utils/fileRisk.ts` - file-size safety assessment.
- `src/utils/exportCsv.ts` - CSV/XLSX/audit export helpers.
- `src/utils/reviewChecks.ts` - duplicate and percentile review helpers.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev -- --host 127.0.0.1
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Verification Scripts

Run linting:

```bash
npm run lint
```

Run file-risk checks:

```bash
npm run test:file-risk
```

Run review-check utility tests:

```bash
npm run test:review-checks
```

Run store overlay checks:

```bash
npm run test:store-overlays
```

Run export checks:

```bash
npm run test:exports
```

Run synthetic CSV capacity checks:

```bash
npm run check:capacity
```

Recommended full local verification:

```bash
npm run build
npm run lint
npm run test:file-risk
npm run test:review-checks
npm run test:store-overlays
npm run test:exports
npm run check:capacity
```

## Manual QA Checklist

- Load a simple numeric CSV.
- Load a mixed numeric/text CSV.
- Load a multi-sheet XLSX file.
- Confirm text-only columns do not appear as numeric value columns.
- Preview outside typical range, far from average, missing values, duplicate values, and percentile bounds.
- Toggle a preview tool on and off.
- Select and unselect points from the chart.
- Select rows from the Review Queue.
- Apply review/problem/accepted/custom highlights.
- Switch columns and confirm highlights persist when returning.
- Replace a selected value with a new value.
- Blank a selected value.
- Undo the most recent cleaning/highlight action.
- Hide and show blanked points.
- Export CSV and confirm blanked/replaced values are correct.
- Export XLSX and confirm highlight colors and cleaned values are correct.
- Export Audit Log CSV and confirm actions, reasons, and notes are recorded.
- Try a file near warning/rejection thresholds and confirm file-risk behavior.

## Current Limitations

- The app is intended for moderate local files, not very large datasets.
- XLSX export creates a clean workbook focused on data and highlight fills; it does not preserve every original Excel formatting detail.
- Preview tools suggest values for review. They do not automatically clean data.
- Data edits are controlled overlays, not full spreadsheet editing.
- There is no session save/load feature yet.
- There is no backend, user account, sharing, or cloud storage.

## Roadmap Ideas

Future work may include:

- Better onboarding/help content.
- Larger-file performance optimization.
- More export QA across Excel, Numbers, and LibreOffice.
- Optional sample datasets.
- More utility tests for statistics, parsing, and exports.
- Transparent review-priority signals that remain human-in-the-loop.

## Development Notes

- Keep raw imported data immutable.
- Store user decisions separately in cell state.
- Preserve stable cell IDs using `sheetName::rowIndex::columnName`.
- Do not delete rows during cleaning.
- Keep audit log entries readable and exportable.
- Keep preview suggestions temporary until the user explicitly highlights, blanks, or replaces values.
- Avoid adding server-side dependencies or workflows.
