import type { AuditActionType } from '../types/data'
import type { IconName } from '../components/Icon'
import { formatNumber } from './stats'

export function hasCompleteAuditReason(reasonCategory: string, reasonNote: string): boolean {
  return reasonCategory.trim() !== '' && reasonNote.trim() !== ''
}

export function actionIconName(actionType: AuditActionType): IconName {
  switch (actionType) {
    case 'mark_review': return 'flag'
    case 'mark_problem': return 'alert'
    case 'mark_keep': return 'check-circle'
    case 'mark_custom': return 'palette'
    case 'clear_mark': return 'x-circle'
    case 'blank_selected':
    case 'blank_problem':
    case 'blank_review': return 'eraser'
    case 'replace_value': return 'swap'
    case 'transform_log':
    case 'transform_log10': return 'compress'
    case 'transform_sqrt': return 'soften'
    case 'transform_boxcox': return 'auto'
    case 'transform_zscore': return 'bell'
    case 'impute_mean':
    case 'impute_median':
    case 'impute_interpolate': return 'fill'
    case 'undo': return 'undo'
  }
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
    case 'impute_mean':
      return typeof newValue === 'number' ? `Filled with column mean (${formatNumber(newValue)})` : 'Filled with column mean'
    case 'impute_median':
      return typeof newValue === 'number' ? `Filled with column median (${formatNumber(newValue)})` : 'Filled with column median'
    case 'impute_interpolate':
      return typeof newValue === 'number'
        ? `Filled with linear interpolation (${formatNumber(newValue)})`
        : 'Filled with linear interpolation'
    case 'undo': return 'Undone'
    default: return String(actionType)
  }
}
