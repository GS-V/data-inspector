import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalPortalProps = {
  children: ReactNode
  onBackdropClick?: () => void
}

export function ModalPortal({ children, onBackdropClick }: ModalPortalProps) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onBackdropClick}>
      {children}
    </div>,
    document.body,
  )
}
