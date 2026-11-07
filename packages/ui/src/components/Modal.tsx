'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../cn';

/** Native <dialog>: focus is trapped and Escape closes it. Closing is reported once through `onClose`. */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-2xl border border-navy-100 bg-white p-0 shadow-2xl backdrop:bg-black/50',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-navy-500 hover:bg-navy-50 hover:text-navy-900"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
