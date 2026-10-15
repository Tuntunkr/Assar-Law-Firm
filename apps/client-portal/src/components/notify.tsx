import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  text: string;
}
const Ctx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export const useNotify = () => useContext(Ctx);

/** Announces messages to screen readers (polite for success, assertive for errors) and shows them briefly. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        <div role="status" aria-live="polite">
          {toasts
            .filter((t) => t.tone === 'success')
            .map((t) => (
              <p
                key={t.id}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow"
              >
                {t.text}
              </p>
            ))}
        </div>
        <div aria-live="assertive" aria-atomic="false">
          {toasts
            .filter((t) => t.tone === 'error')
            .map((t) => (
              <p
                key={t.id}
                className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 shadow"
              >
                {t.text}
              </p>
            ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}
