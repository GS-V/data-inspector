import type { AuditActionType } from '../types/data'

export function hasCompleteAuditReason(reasonCategory: string, reasonNote: string): boolean {
  return reasonCategory.trim() !== '' && reasonNote.trim() !== ''
}

export function actionLabel(actionType: AuditActionType, newValue?: unknown): string {
  switch (actionType) {
    case 'mark_review': return 'Flagged for review'
    case 'mark_problem': return 'Marked as problem'
    case 'mark_keep': return 'Marked as accepted'
    case 'mark_custom': return 'Custom highlight'
    case 'clear_mark': return 'Highlight removed'
    case 'blank_selected':
    case 'blank_problem':
    case 'blank_review': return 'Blanked'
    case 'replace_value': return newValue !== null && newValue !== undefined ? `Replaced with ${String(newValue)}` : 'Replaced'
    case 'transform_log': return 'Log transform applied'
    case 'transform_log10': return 'Log10 transform applied'
    case 'transform_sqrt': return 'Square root transform applied'
    case 'transform_boxcox': return 'Box-Cox transform applied'
    case 'transform_zscore': return 'Z-score transform applied'
    case 'undo': return 'Undone'
    default: return String(actionType)
  }
}
