import { ApiClientError, type StaffClient, type StaffMe } from '@assar/api-client';
import type { Permission } from '@assar/types';
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
  | { status: 'authed'; me: StaffMe }
  | { status: 'error'; message: string };

interface AuthApi {
  state: AuthState;
  client: StaffClient;
  /** Throws ApiClientError; code `MFA_REQUIRED` means "ask for the authentication code and retry". */
  login(input: { email: string; password: string; mfaCode?: string }): Promise<void>;
  register(input: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
  }): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  can(permission: Permission): boolean;
  retry(): void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ client, children }: { client: StaffClient; children: ReactNode }) {
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
  const register = useCallback<AuthApi['register']>(
    async (input) => setState({ status: 'authed', me: await client.register(input) }),
    [client],
  );
  const logout = useCallback(async () => {
    await client.logout().catch(() => undefined);
    setState({ status: 'anonymous' });
  }, [client]);
  const refresh = useCallback(async () => {
    setState({ status: 'authed', me: await client.me() });
  }, [client]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const can = useCallback(
    (p: Permission) => state.status === 'authed' && state.me.permissions.includes(p),
    [state],
  );

  const value = useMemo(
    () => ({ state, client, login, register, logout, refresh, can, retry }),
    [state, client, login, register, logout, refresh, can, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** The signed-in user. Only call below RequireAuth. */
export function useMe(): StaffMe {
  const { state } = useAuth();
  if (state.status !== 'authed') throw new Error('useMe requires a signed-in user');
  return state.me;
}
