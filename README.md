# Data Inspector

A browser-only, privacy-first tool for visual inspection and quality control of CSV and XLSX files.

Open a spreadsheet locally, inspect numeric values, flag or clean outliers, and export cleaned data with a full audit trail — without uploading anything to a server.

> **Files never leave your browser.** There is no backend, no database, and no authentication.

---

## What It Does

- Opens CSV and XLSX files (including multi-sheet workbooks) locally in the browser.
- Detects numeric columns automatically while preserving text columns.
- Displays scatter, histogram, box, violin, Q-Q, density, and cumulative-distribution views for selected value columns.
- Suggests values for review using configurable tools:
  - Outside typical range / far from average
  - Missing or duplicate values
  - Threshold filters, domain range checks, percentile bounds
- Applies persistent, labeled highlights (review, problem, accepted, custom color).
- Supports controlled cleaning overlays — replace or blank selected values without modifying raw data.
- Fills missing values with a column mean, column median, or linear interpolation between the nearest
  non-missing neighbors — scoped to currently missing cells only, marked distinctly so filled values
  stay visually and programmatically distinguishable from real measurements.
- Applies distribution transforms (log, log10, square root, Box-Cox, z-score) to one or more numeric
  columns, with before/after statistics, skewness, and a normality test (Shapiro-Wilk, Jarque-Bera, or
  Anderson-Darling) per transform. Each transform-history entry can copy an equivalent one-line pandas
  (Python) or base R snippet to the clipboard.
- Generates a QC report summarizing the cleaning breakdown (flagged/problem/accepted/custom/blanked/
  replaced/imputed counts) and before/after column statistics (count, missing, mean, median, SD, min,
  max, skewness, and normality verdict for transformed columns), exportable as CSV or PDF.
- Exports cleaned CSV/XLSX data (highlight colors preserved in XLSX) and a separate Audit Log CSV.
- Warns before leaving a session with unsaved work.

---

## Getting Started

### Option A — Docker (recommended for most users)

No Node.js installation required. You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/).

**Run from source:**

```bash
git clone <repo-url>
cd data-inspector
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

To stop: `Ctrl+C`, then `docker compose down`.

**Rebuild after code changes:**

```bash
docker compose up --build
```

Docker caches dependency layers, so rebuilds after source-only changes are fast.

---

### Option B — Local Development (Node.js)

Requires Node.js 18+.

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Open [http://localhost:5173](http://localhost:5173).

**Production build:**

```bash
npm run build
npm run preview
```

---

## Privacy Model

Data Inspector has no backend, database, authentication system, or server-side storage.

All file parsing and state management happen in the browser. The app keeps user edits as an overlay on top of the original imported data — the raw data is never modified.

The data model separates:

- **Raw data** — original imported values, immutable.
- **Selection** — temporary active cells chosen by the user.
- **Preview** — temporary suggested cells from review tools.
- **Cell state** — persistent highlights, blanked values, replacement values, and notes.
- **Audit log** — action records for all review, cleaning, replacement, undo, and export events.

---

## Core Workflow

1. Open a CSV or XLSX file.
2. Choose a sheet, value column, X-axis column, and plot type.
3. Inspect values visually in the chart.
4. Use preview tools to surface values for review.
5. Select points manually or from the Review Queue.
6. Apply highlights to document review decisions.
7. Optionally replace or blank selected values.
8. Add reason, category, and note context for cleaning decisions.
9. Export cleaned CSV/XLSX and the Audit Log CSV.

---

## Supported Files

**Input:** `.csv`, `.xlsx`, multi-sheet `.xlsx`

**Export:**
- **CSV** — active sheet only, values-only (no colors), blanked/replaced values applied.
- **XLSX** — full workbook with highlight fills, blanked/replaced values applied.
- **Audit Log CSV** — separate action history with sheet, row, column, old/new value, method, reason, and note fields.

---

## File-Size Safety

File size is checked before parsing begins. Rejected or canceled files do not replace the current session.

| Format | Safe | Warning | High Risk | Rejected |
|--------|------|---------|-----------|----------|
| CSV    | ≤ 50 MB | 50–250 MB | 250–500 MB | > 500 MB |
| XLSX   | ≤ 25 MB | 25–75 MB | 75–100 MB | > 100 MB |

Hard ceiling: files over 1 GB are always rejected.

On devices with ≤ 4 GB RAM (`navigator.deviceMemory`), thresholds are reduced to 75% of the values above.

---

## Tech Stack

- React 19 + TypeScript
- Vite
- Zustand
- Papa Parse
- SheetJS (`xlsx`) + ExcelJS
- Plotly / react-plotly.js
- Mantine (UI components)
- ESLint

---

## Project Structure

```text
src/
  components/    React UI components
  store/         Zustand application state and actions
  types/         Shared TypeScript types
  utils/         Parsing, export, statistics, review checks, file risk
scripts/         Verification and capacity scripts
docs/            Project documentation and QA checklist
public/          Static browser assets
```

Key files:

| File | Purpose |
|------|---------|
| `src/store/useDataInspectorStore.ts` | Main application state and all actions |
| `src/components/FileLoader.tsx` | Local file loading and file-risk checks |
| `src/components/InspectorChart.tsx` | Chart rendering and point interaction |
| `src/components/InspectionTools.tsx` | Preview and highlight workflow |
| `src/components/ActionToolbar.tsx` | Cleaning, export, and audit actions |
| `src/components/SelectionTable.tsx` | Review Queue |
| `src/utils/fileRisk.ts` | File-size safety assessment |
| `src/utils/exportCsv.ts` | CSV/XLSX/audit export helpers |
| `src/utils/reviewChecks.ts` | Duplicate and percentile review helpers |

---

## Verification Scripts

```bash
npm run lint                  # ESLint
npm run test:file-risk        # File-risk threshold checks
npm run test:review-checks    # Review-check utility tests
npm run test:transform-code   # Copy-as-code (pandas/R) snippet generation
npm run test:qc-report        # QC report breakdown and column-stat logic
npm run test:store-overlays   # Store overlay logic (marks, blank, replace, transform, impute)
npm run test:exports          # Export correctness checks
npm run test:normality        # Normality test directional/edge-case checks
npm run test:shapiro-groundtruth        # Shapiro-Wilk vs. scipy ground truth
npm run test:normality-threshold-clamp  # Normality α threshold clamping
npm run check:capacity        # Synthetic CSV capacity checks
```

Recommended pre-release run:

```bash
npm run build && npm run lint && npm run test:file-risk && npm run test:review-checks && npm run test:store-overlays && npm run test:exports && npm run check:capacity
```

See [`docs/qa-checklist.md`](docs/qa-checklist.md) for the manual QA checklist.

---

## Current Limitations

- Intended for moderate local files, not very large datasets.
- XLSX export produces a clean workbook focused on data and highlight fills; original Excel formatting details are not preserved.
- Preview tools suggest values for review — they do not automatically clean data.
- Data edits (blank, replace, transform, impute) are controlled overlays, not full spreadsheet editing.
- Imputation fills the currently-missing (or currently-selected) cells with a column mean, column
  median, or linear interpolation between the nearest non-missing neighbors — it is not a general
  statistical imputation engine. There is no uncertainty/variance estimate for filled values, only the
  column's own currently-visible values are considered, and a missing value at either edge of the
  column (no neighbor on one side) is left unfilled rather than guessed.
- The QC report's normality test only runs for columns with an applied transform, to avoid unasked-for
  computation on every column of a large sheet; skewness and missing-count are computed for all
  numeric columns regardless.
- "Copy as code" for a z-score transform applied across several columns in one batch reuses that
  batch's combined mean/SD on every generated line, rather than recomputing each column's own —
  matching how the transform's before/after statistics are stored today.
- Data Inspector is a preprocessing/QC tool, not a statistical analysis platform: transforms, skewness,
  and normality tests exist to help characterize and clean data before it leaves the browser, not to
  test hypotheses or draw conclusions about relationships between columns.
- No session save/load feature yet.
- No backend, user accounts, sharing, or cloud storage.

---

## Development Notes

- Keep raw imported data immutable.
- Store user decisions separately in cell state.
- Stable cell IDs use the format `sheetName::rowIndex::columnName`.
- Do not delete rows during cleaning.
- Keep audit log entries readable and exportable.
- Keep preview suggestions temporary until the user explicitly highlights, blanks, or replaces values.
- Do not introduce server-side dependencies.

---

## Roadmap

- Better onboarding and help content.
- Larger-file performance optimization.
- Export QA across Excel, Numbers, and LibreOffice.
- Optional sample datasets for onboarding.
- More utility tests for statistics, parsing, and exports.
- Transparent review-priority signals that remain human-in-the-loop.
