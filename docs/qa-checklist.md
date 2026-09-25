# Manual QA Checklist

Run through this checklist before tagging a release or after significant changes to the UI or data pipeline.

## File Loading

- [ ] Load a simple numeric CSV.
- [ ] Load a mixed numeric/text CSV.
- [ ] Load a multi-sheet XLSX file.
- [ ] Confirm text-only columns do not appear as numeric value columns.
- [ ] Try a file near warning/rejection thresholds and confirm file-risk behavior.

## Preview Tools

- [ ] Preview: outside typical range.
- [ ] Preview: far from average.
- [ ] Preview: missing values.
- [ ] Preview: duplicate values.
- [ ] Preview: percentile bounds.
- [ ] Toggle a preview tool on and off.

## Selection

- [ ] Select and unselect points from the chart.
- [ ] Select rows from the Review Queue.

## Highlights

- [ ] Apply review, problem, accepted, and custom highlights.
- [ ] Switch columns and confirm highlights persist when returning.

## Cleaning

- [ ] Replace a selected value with a new value.
- [ ] Blank a selected value.
- [ ] Undo the most recent cleaning/highlight action.
- [ ] Hide and show blanked points.

## Export

- [ ] Export CSV — confirm blanked and replaced values are correct.
- [ ] Export XLSX — confirm highlight colors and cleaned values are correct.
- [ ] Export Audit Log CSV — confirm actions, reasons, and notes are recorded.
