export function hasCompleteAuditReason(reasonCategory: string, reasonNote: string): boolean {
  return reasonCategory.trim() !== '' && reasonNote.trim() !== ''
}
