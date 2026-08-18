export type IconName =
  | 'flag' | 'alert' | 'check-circle' | 'palette' | 'x-circle'
  | 'outlier' | 'copy' | 'distance' | 'swap' | 'eraser' | 'undo'
  | 'download' | 'clipboard' | 'report' | 'compress' | 'soften' | 'auto' | 'bell'
  | 'sun' | 'search' | 'eye' | 'folder-open' | 'chevron-down' | 'fill'

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon icon-${name}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

export function IconSprite() {
  return (
    <svg style={{ display: 'none' }} aria-hidden="true">
      <symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 2 20h20L12 3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><polyline points="8 12 11 15 16 9" />
      </symbol>
      <symbol id="i-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a9 9 0 1 0 0 18c1.4 0 1.9-.9 1.9-1.8 0-.5-.4-1.3-.4-1.9 0-1 .9-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z" />
        <circle cx="7.6" cy="10.6" r="1" fill="currentColor" stroke="none" /><circle cx="10.2" cy="7.2" r="1" fill="currentColor" stroke="none" /><circle cx="14.6" cy="7.6" r="1" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-x-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><line x1="9.2" y1="9.2" x2="14.8" y2="14.8" /><line x1="14.8" y1="9.2" x2="9.2" y2="14.8" />
      </symbol>
      <symbol id="i-outlier" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" /><circle cx="13" cy="16" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="5" r="3.4" strokeDasharray="2.5 2.5" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="3.5" width="12" height="12" rx="1.5" /><path d="M8 16v1.5A1.5 1.5 0 0 0 9.5 19H18a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 18 7.5h-2" />
      </symbol>
      <symbol id="i-distance" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="8" x2="4" y2="16" /><line x1="20" y1="8" x2="20" y2="16" /><line x1="4" y1="12" x2="20" y2="12" strokeDasharray="3 3" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-swap" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8h14" /><polyline points="14 4 18 8 14 12" /><path d="M21 16H7" /><polyline points="10 20 6 16 10 12" />
      </symbol>
      <symbol id="i-eraser" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6.5" y="10.5" width="15" height="7" rx="2" transform="rotate(-45 14 14)" /><line x1="3" y1="21" x2="10" y2="21" />
      </symbol>
      <symbol id="i-undo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 14 4 9 9 4" /><path d="M4 9h10a6 6 0 0 1 0 12H10" />
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12" /><polyline points="7 11 12 16 17 11" /><path d="M4 20h16" />
      </symbol>
      <symbol id="i-clipboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5.5" y="4" width="13" height="17" rx="2" /><path d="M9 4V2.6A1.6 1.6 0 0 1 10.6 1h2.8A1.6 1.6 0 0 1 15 2.6V4" />
        <line x1="8.5" y1="10" x2="15.5" y2="10" /><line x1="8.5" y1="13.5" x2="15.5" y2="13.5" /><line x1="8.5" y1="17" x2="13" y2="17" />
      </symbol>
      <symbol id="i-report" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="20" x2="21" y2="20" /><rect x="5" y="13" width="3.2" height="7" /><rect x="10.4" y="8" width="3.2" height="12" /><rect x="15.8" y="4" width="3.2" height="16" />
      </symbol>
      <symbol id="i-compress" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" /><path d="M5 12h4" /><polyline points="7 9 5 12 7 15" /><path d="M19 12h-4" /><polyline points="17 9 19 12 17 15" />
      </symbol>
      <symbol id="i-soften" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15c2 0 2.5-8 5-8s2 6 4 6 2.5-8 4-8 1.5 5 3 5" />
      </symbol>
      <symbol id="i-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.6" /><line x1="12" y1="3" x2="12" y2="5.5" /><line x1="12" y1="18.5" x2="12" y2="21" /><line x1="3" y1="12" x2="5.5" y2="12" /><line x1="18.5" y1="12" x2="21" y2="12" />
        <line x1="5.8" y1="5.8" x2="7.4" y2="7.4" /><line x1="16.6" y1="16.6" x2="18.2" y2="18.2" /><line x1="5.8" y1="18.2" x2="7.4" y2="16.6" /><line x1="16.6" y1="7.4" x2="18.2" y2="5.8" />
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17c3-1 4-11 9-11s6 10 9 11" /><line x1="12" y1="17.5" x2="12" y2="7" strokeDasharray="2 2" />
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="22" /><line x1="2" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="22" y2="12" />
        <line x1="4.6" y1="4.6" x2="6.3" y2="6.3" /><line x1="17.7" y1="17.7" x2="19.4" y2="19.4" /><line x1="4.6" y1="19.4" x2="6.3" y2="17.7" /><line x1="17.7" y1="6.3" x2="19.4" y2="4.6" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.3" y1="15.3" x2="20.5" y2="20.5" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-folder-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6l-3 9V7z" /><path d="M3 19l2.5-8H21l-2.5 8H3z" />
      </symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </symbol>
      <symbol id="i-fill" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="4.5" cy="12" r="2" /><circle cx="19.5" cy="12" r="2" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <line x1="6.7" y1="12" x2="9.7" y2="12" strokeDasharray="2 2" /><line x1="14.3" y1="12" x2="17.3" y2="12" strokeDasharray="2 2" />
      </symbol>
    </svg>
  )
}
