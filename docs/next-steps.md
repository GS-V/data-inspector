# Data Inspector Next Steps

## Notes from latest UI pass

- Current information tags are useful and may be better than traditional hover-only tooltips.
- Tooltip behavior is not necessary right now if information tags explain the workflow clearly.
- Keep persistent marks across column switching. This is a core feature and should not be removed.
- Marked CSV export was removed from the main workflow because it was cluttered and CSV cannot store colors.
- CSV export should stay focused on cleaned values and audit logs.
- Visual highlighting should be handled through the in-app view and eventually Highlighted XLSX export.
- Continue improving the UI toward a simple, polished, easy-to-use data inspection tool.

## Next priorities

1. Manual test with dummy CSV and small XLSX.
2. Verify light/dark mode readability.
3. Verify simplified preview tools.
4. Verify cleaned CSV and audit log exports.
5. Add an optimization pass:
   - Investigate the large Vite bundle warning.
   - Plotly is likely the main bundle-size driver.
   - Consider dynamic imports/code splitting for Plotly.
   - Consider lazy-loading chart components only after a file is loaded.
   - Consider whether a lighter charting library is worth evaluating later.
6. Decide whether Highlighted XLSX needs a style-capable writer such as `exceljs`.
7. Add a small onboarding/help panel explaining:
   - Preview = temporary suggestion
   - Mark = persistent highlight
   - Blank = cleaning action
   - Audit = record of decisions
8. Add stronger manual QA coverage:
   - CSV with mixed numeric/text columns.
   - XLSX with multiple sheets.
   - Missing values.
   - Extreme values.
   - Column switching after marking.
   - Undo after blanking.
   - Export after several mark/blank actions.
9. Improve export experience:
   - Confirm Cleaned CSV is simple and predictable.
   - Confirm Audit Log CSV is readable.
   - Revisit Highlighted XLSX as the preferred visual-highlight export.
10. Consider adding sample datasets in a safe `public/sample-data/` folder using only fake data.
11. Consider adding a README with:
   - What the app does.
   - Privacy-first/local-browser explanation.
   - How to run locally.
   - Current limitations.
   - Roadmap.
12. Consider basic tests for core utilities:
   - numeric parsing.
   - quartiles/IQR.
   - z-score.
   - CSV parsing.
   - export generation.