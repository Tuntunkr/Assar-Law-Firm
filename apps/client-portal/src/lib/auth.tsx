import { ApiClientError, type PortalClient } from '@assar/api-client';
import type { PortalMe } from '@assar/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SESSION_EXPIRED_EVENT } from './client';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; notice?: string }
  | { status: 'authed'; me: PortalMe }
  | { status: 'error'; message: string };

interface AuthApi {
  state: AuthState;
  client: PortalClient;
  login(input: { organizationSlug: string; email: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  retry(): void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ client, children }: { client: PortalClient; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    client.me().then(
      (me) => !cancelled && setState({ status: 'authed', me }),
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError && e.status === 401) setState({ status: 'anonymous' });
        else
          setState({
            status: 'error',
            message: e instanceof ApiClientError ? e.message : 'Something went wrong.',
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  // Any call that finds the session gone sends the user back to sign-in with an explanation.
  useEffect(() => {
    const onExpired = () =>
      setState((s) =>
        s.status === 'authed'
          ? { status: 'anonymous', notice: 'Your session has ended. Please sign in again.' }
          : s,
      );
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback<AuthApi['login']>(
    async (input) => setState({ status: 'authed', me: await client.login(input) }),
    [client],
  );
  const logout = useCallback(async () => {
    await client.logout().catch(() => undefined); // signing out locally even if the call fails
    setState({ status: 'anonymous' });
  }, [client]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(
    () => ({ state, client, login, logout, retry }),
    [state, client, login, logout, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
