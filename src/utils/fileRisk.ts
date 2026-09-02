/*
 * Classify a chosen file into a load-risk tier before any parsing starts.
 * Pure functions -- no React, no Zustand, no file reads. Only the name, size, and type are used.
 * The tier decides whether the loader proceeds, asks the user to confirm, or refuses the file.
 */
export type FileKind = 'csv' | 'xlsx' | 'unsupported'

export type FileRiskTier = 'safe' | 'warning' | 'high-risk' | 'reject'

export type FileLoadRisk = {
  tier: FileRiskTier
  kind: FileKind
  title: string
  message: string
  nextSteps: string
  fileSizeLabel: string
  requiresConfirmation: boolean
}

export type FileRiskInput = {
  name: string
  size: number
  type?: string
  deviceMemoryGb?: number
}

const MB = 1024 * 1024
const GB = 1024 * MB

// Every threshold exists because parsing runs in the browser tab, on the main thread, with the
// whole file held in memory. A parser expands a file well past its size on disk, so the tab can
// exhaust its heap and crash. A 32-bit or low-memory device runs out far sooner than a desktop,
// which is what lowMemoryThresholdMultiplier accounts for.
//
// Tier boundaries per file kind, measured against the size on disk:
//   up to safeBytes      -> safe, load with no prompt
//   up to warningBytes   -> warning, load is slow, ask the user to confirm
//   up to highRiskBytes  -> high risk, the tab may freeze or fail, ask the user to confirm
//   above highRiskBytes  -> reject, refuse before any parsing starts
// absoluteRejectBytes (1 GB) rejects a file of any kind, whatever the adjusted per-kind limits
// work out to. XLSX limits sit far below the CSV ones because XLSX arrives compressed: it
// inflates to several times its stored size, then again into cell objects.
export const FILE_RISK_LIMITS = {
  absoluteRejectBytes: GB,
  // Applied to all three per-kind thresholds on a device reporting 4 GB of memory or less.
  lowMemoryThresholdMultiplier: 0.75,
  csv: {
    safeBytes: 50 * MB,
    warningBytes: 250 * MB,
    highRiskBytes: 500 * MB,
  },
  xlsx: {
    safeBytes: 25 * MB,
    warningBytes: 75 * MB,
    highRiskBytes: 100 * MB,
  },
} as const

function inferFileKind(fileName: string, mimeType?: string): FileKind {
  const lowerName = fileName.toLowerCase()
  const lowerType = mimeType?.toLowerCase() ?? ''

  if (lowerName.endsWith('.csv') || lowerType.includes('csv')) {
    return 'csv'
  }

  if (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerType.includes('spreadsheet') ||
    lowerType.includes('excel')
  ) {
    return 'xlsx'
  }

  return 'unsupported'
}

export function formatFileSize(bytes: number): string {
  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(1)} GB`
  }

  if (bytes >= MB) {
    const megabytes = bytes / MB
    return `${megabytes >= 100 ? Math.round(megabytes).toLocaleString() : megabytes.toFixed(1)} MB`
  }

  const kilobytes = bytes / 1024
  return `${Math.max(1, Math.round(kilobytes)).toLocaleString()} KB`
}

function adjustedLimits(kind: 'csv' | 'xlsx', deviceMemoryGb?: number) {
  const limits = FILE_RISK_LIMITS[kind]
  const multiplier =
    typeof deviceMemoryGb === 'number' && deviceMemoryGb <= 4
      ? FILE_RISK_LIMITS.lowMemoryThresholdMultiplier
      : 1

  return {
    safeBytes: limits.safeBytes * multiplier,
    warningBytes: limits.warningBytes * multiplier,
    highRiskBytes: limits.highRiskBytes * multiplier,
  }
}

function messageForTier(tier: FileRiskTier, kind: FileKind, fileSizeLabel: string): Omit<FileLoadRisk, 'kind' | 'fileSizeLabel'> {
  if (tier === 'reject') {
    return {
      tier,
      title: 'File is too large',
      message:
        kind === 'unsupported'
          ? 'Please choose a CSV or XLSX file. File was not uploaded or parsed.'
          : `${fileSizeLabel} is too large for the current browser-local version of Data Inspector. File was not uploaded or parsed.`,
      nextSteps:
        kind === 'unsupported'
          ? 'Choose a supported CSV or XLSX file.'
          : 'Try a smaller export, a single sheet, or a filtered subset.',
      requiresConfirmation: false,
    }
  }

  if (tier === 'high-risk') {
    return {
      tier,
      title: 'High-risk file size',
      message:
        'This file is large for browser-local processing. Data Inspector runs fully in your browser. Loading it may freeze the tab or fail.',
      nextSteps: 'Continue only if you are comfortable waiting. Canceling keeps the current session unchanged.',
      requiresConfirmation: true,
    }
  }

  if (tier === 'warning') {
    return {
      tier,
      title: 'Large file detected',
      message:
        'Large file detected. Data Inspector runs fully in your browser, so this file may load slowly or use a lot of memory.',
      nextSteps: 'Continue to load it, or cancel and use a smaller export. Canceling keeps the current session unchanged.',
      requiresConfirmation: true,
    }
  }

  return {
    tier,
    title: 'File looks safe to load',
    message: 'This file is within the current browser-local safety guidelines.',
    nextSteps: '',
    requiresConfirmation: false,
  }
}

export function assessFileLoadRisk(input: FileRiskInput): FileLoadRisk {
  const kind = inferFileKind(input.name, input.type)
  const fileSizeLabel = formatFileSize(input.size)

  if (kind === 'unsupported') {
    return {
      kind,
      fileSizeLabel,
      ...messageForTier('reject', kind, fileSizeLabel),
    }
  }

  if (input.size > FILE_RISK_LIMITS.absoluteRejectBytes) {
    return {
      kind,
      fileSizeLabel,
      tier: 'reject',
      title: 'File is too large',
      message:
        'This file is too large to safely load in the browser. Data Inspector keeps files local, but this version cannot process multi-GB files directly. File was not uploaded or parsed.',
      nextSteps: 'Try a smaller export, a single sheet, or a filtered subset.',
      requiresConfirmation: false,
    }
  }

  const limits = adjustedLimits(kind, input.deviceMemoryGb)
  const tier =
    input.size <= limits.safeBytes
      ? 'safe'
      : input.size <= limits.warningBytes
        ? 'warning'
        : input.size <= limits.highRiskBytes
          ? 'high-risk'
          : 'reject'

  return {
    kind,
    fileSizeLabel,
    ...messageForTier(tier, kind, fileSizeLabel),
  }
}
