import { cn } from '@assar/ui';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useMe } from '../lib/auth';
import { NAV, titleFor } from '../lib/navigation';
import { useTheme } from '../lib/theme';
import { CommandPalette } from './CommandPalette';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const readCollapsed = () => {
  try {
    return localStorage.getItem('assar:sidebar') === 'collapsed';
  } catch {
    return false;
  }
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div
      className="hidden items-center gap-2 rounded-xl border border-navy-100 bg-white px-3 py-1.5 text-navy-700 xl:flex"
      aria-hidden="true"
    >
      <Icon name="clock" size={15} />
      <div className="text-right leading-tight">
        <p className="font-mono text-xs font-medium text-navy-900">
          {now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
        <p className="text-[10px] text-navy-500">
          {now.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const { logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setDrawer(false);
    main.current?.focus();
  }, [pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('assar:sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const link =
    (compact: boolean) =>
    ({ isActive }: { isActive: boolean }) =>
      cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        compact && 'justify-center px-0',
        isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-300 hover:bg-white/5 hover:text-white',
      );

  const sidebar = (compact: boolean) => (
    <>
      <div className={cn('flex items-center gap-3 px-4 py-4', compact && 'justify-center px-0')}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow">
          <Icon name="scale" size={18} />
        </span>
        {!compact && (
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight text-white">Assar</p>
            <p className="truncate text-[11px] text-slate-400">{me.organization.name}</p>
          </div>
        )}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              {!compact && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {g.group}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.to === '/'}
                      className={link(compact)}
                      title={compact ? i.label : undefined}
                      aria-label={i.label}
                    >
                      <Icon name={i.icon} size={18} />
                      {!compact && i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white lg:flex',
            compact && 'justify-center px-0',
          )}
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={compact ? 'chevronRight' : 'chevronLeft'} size={16} />
          {!compact && 'Collapse'}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col bg-[#0b1220] transition-[width] lg:flex',
          collapsed ? 'w-[72px]' : 'w-60',
        )}
      >
        {sidebar(collapsed)}
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawer(false)}
          />
          <aside className="relative flex h-full w-64 flex-col bg-[#0b1220]">
            {sidebar(false)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-navy-100 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-8">
          <button
            className="rounded-md p-2 text-navy-800 hover:bg-navy-50 lg:hidden"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" />
          </button>
          <p className="text-base font-semibold text-navy-900">{titleFor(pathname)}</p>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="hidden w-56 items-center gap-2 rounded-xl border border-navy-100 bg-white px-3 py-2 text-sm text-navy-500 hover:border-navy-200 sm:flex"
            aria-label="Search (Command K)"
          >
            <Icon name="search" size={15} />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-navy-100 bg-navy-50 px-1.5 text-[10px] text-navy-600">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="rounded-md p-2 text-navy-700 hover:bg-navy-50 sm:hidden"
            aria-label="Search"
          >
            <Icon name="search" />
          </button>
          <Clock />
          <NotificationBell />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-md p-2 text-navy-700 hover:bg-navy-50"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-navy-50"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                {initials(me.user.name)}
              </span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-sm font-medium text-navy-900">{me.user.name}</span>
                <span className="block text-[11px] capitalize text-navy-600">{me.role}</span>
              </span>
              <Icon name="chevronDown" size={14} className="text-navy-500" />
            </button>
            {menu && (
              <div
                className="absolute right-0 mt-2 w-48 rounded-xl border border-navy-100 bg-white p-1 shadow-xl"
                onMouseLeave={() => setMenu(false)}
              >
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-navy-800 hover:bg-navy-50"
                  onClick={() => {
                    setMenu(false);
                    navigate('/profile');
                  }}
                >
                  My profile
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-navy-800 hover:bg-navy-50"
                  onClick={async () => {
                    setMenu(false);
                    await logout();
                    navigate('/login', { replace: true });
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main
          id="content"
          ref={main}
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 outline-none sm:px-8"
        >
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
