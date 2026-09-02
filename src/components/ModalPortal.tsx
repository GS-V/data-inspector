import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalPortalProps = {
  children: ReactNode
  onBackdropClick?: () => void
}

export function ModalPortal({ children, onBackdropClick }: ModalPortalProps) {
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        // A click on anything inside `children`, such as a modal's own Export button, still
        // bubbles up to this div. Dismiss only when the backdrop was the real click target.
        // Without the check, every click inside the modal would close it.
        if (event.target === event.currentTarget) {
          onBackdropClick?.()
        }
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
