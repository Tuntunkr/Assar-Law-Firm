import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const ROUTE: Record<string, string> = {
  task: '/tasks',
  event: '/calendar',
  matter: '/matters',
  ai_output: '/ai',
  document: '/matters',
};

export function NotificationBell() {
  const { client } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const state = useAsync(() => client.notifications({ limit: 10 }), [client, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const unread = state.status === 'ready' ? state.data.unread : 0;
  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        className="relative rounded-md p-2 text-navy-800 hover:bg-navy-50"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-accent-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-navy-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-2">
            <p className="text-sm font-semibold text-navy-900">Notifications</p>
            {unread > 0 && (
              <button
                className="text-xs font-medium text-accent-700 hover:underline"
                onClick={async () => {
                  await client.markAllNotificationsRead();
                  state.reload();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {state.status === 'ready' && state.data.data.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-navy-600">
                You are all caught up.
              </li>
            )}
            {state.status === 'error' && (
              <li className="px-4 py-6 text-center text-sm text-red-700">{state.error.message}</li>
            )}
            {state.status === 'ready' &&
              state.data.data.map((n) => (
                <li key={n.id} className="border-b border-navy-50 last:border-0">
                  <button
                    className="block w-full px-4 py-3 text-left hover:bg-navy-50"
                    onClick={async () => {
                      if (!n.readAt) await client.markNotificationRead(n.id).catch(() => undefined);
                      setOpen(false);
                      if (n.link) navigate(ROUTE[n.link.type] ?? '/');
                    }}
                  >
                    <p
                      className={`text-sm ${n.readAt ? 'text-navy-700' : 'font-semibold text-navy-900'}`}
                    >
                      {n.title}
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-navy-600">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-navy-500">{formatDateTime(n.createdAt)}</p>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
