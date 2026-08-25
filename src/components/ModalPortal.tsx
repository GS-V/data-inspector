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
        // A click starting anywhere inside `children` (e.g. a modal's own Export button) still
        // bubbles up to this div. Only treat it as a backdrop click -- and thus a dismissal --
        // when the backdrop itself was the actual click target, not a bubbled child click.
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
