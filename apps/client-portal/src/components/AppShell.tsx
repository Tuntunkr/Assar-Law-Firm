import { Button } from '@assar/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50'}`;

export function AppShell() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Move focus to the content on navigation so keyboard and screen-reader users land in the right place.
  useEffect(() => main.current?.focus(), [pathname]);

  if (state.status !== 'authed') return null;
  const { me } = state;

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight text-navy-900">
            {me.organization.name}
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Matters
            </NavLink>
            <NavLink to="/account" className={linkClass}>
              Account
            </NavLink>
          </nav>
          <div className="flex items-center gap-3 text-sm text-navy-700">
            <span className="hidden sm:inline">
              {me.clientUser.name} · {me.client.name}
            </span>
            <Button
              variant="secondary"
              loading={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main
        id="content"
        ref={main}
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 outline-none"
      >
        <Outlet />
      </main>
      <footer className="border-t border-navy-100 bg-white px-5 py-4 text-center text-xs text-navy-600">
        This portal shows information {me.organization.name} has chosen to share with you. Contact
        your legal team directly with any questions.
      </footer>
    </div>
  );
}
