import { Modal } from '@assar/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { NAV } from '../lib/navigation';
import { Icon, type IconName } from './Icon';

interface Result {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
  to: string;
}

/** ⌘K / Ctrl+K: jump to a page, or find a client or matter by name. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client, can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setFound([]);
      setActive(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setFound([]);
    let live = true;
    const t = setTimeout(async () => {
      const [cs, ms] = await Promise.all([
        can('client:read') ? client.clients({ q: term, limit: 5 }).catch(() => null) : null,
        can('matter:read') ? client.matters({ q: term, limit: 5 }).catch(() => null) : null,
      ]);
      if (!live) return;
      setFound([
        ...(cs?.data ?? []).map((c) => ({
          key: `c${c.id}`,
          label: c.name,
          hint: 'Client',
          icon: 'clients' as const,
          to: `/clients/${c.id}`,
        })),
        ...(ms?.data ?? []).map((m) => ({
          key: `m${m.id}`,
          label: `${m.matterNumber} — ${m.title}`,
          hint: 'Matter',
          icon: 'matters' as const,
          to: `/matters/${m.id}`,
        })),
      ]);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, client, can]);

  const pages = useMemo<Result[]>(
    () =>
      NAV.flatMap((g) => g.items)
        .filter((i) => !i.perm || can(i.perm))
        .filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()))
        .map((i) => ({ key: i.to, label: i.label, hint: 'Page', icon: i.icon, to: i.to })),
    [q, can],
  );
  const results = [...found, ...pages];
  const go = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    navigate(r.to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search">
      <div className="-mt-2 space-y-3">
        <input
          ref={input}
          aria-label="Search pages, clients and matters"
          placeholder="Search pages, clients and matters…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === 'Enter') go(results[active]);
          }}
          className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus-visible:outline-2 focus-visible:outline-accent-500"
        />
        <ul role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-navy-600">No matches.</li>
          )}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-accent-600/10 text-accent-700' : 'text-navy-800'}`}
              >
                <Icon name={r.icon} size={16} />
                <span className="flex-1 truncate">{r.label}</span>
                <span className="text-xs text-navy-500">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
