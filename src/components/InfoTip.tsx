import { useState } from 'react'

type InfoTipProps = {
  label: string
}

export function InfoTip({ label }: InfoTipProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <span className="info-tip-wrap">
      <button
        className="info-tip"
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        title={label}
        onClick={() => setIsOpen((current) => !current)}
        onBlur={() => setIsOpen(false)}
      >
        ?
      </button>
      <span className={`info-popover ${isOpen ? 'open' : ''}`} role="tooltip">
        {label}
      </span>
    </span>
  )
}
