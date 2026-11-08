import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string; notice?: string } | null) ?? {};
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'authed') return <Navigate to={from.from ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password, ...(needsCode ? { mfaCode: mfaCode.trim() } : {}) });
      navigate(from.from ?? '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'MFA_REQUIRED') {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Sign in</h1>
          <p className="mt-1 text-sm text-navy-600">Use your firm account.</p>
        </div>
        {from.notice && <Alert tone="info">{from.notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={needsCode}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={needsCode}
        />
        {needsCode && (
          <TextField
            id="mfa"
            label="Authentication code"
            hint="The 6-digit code from your authenticator app, or a recovery code."
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            required
          />
        )}
        <Button type="submit" loading={busy} className="w-full">
          {needsCode ? 'Verify and sign in' : 'Sign in'}
        </Button>
        {!needsCode && (
          <p className="text-center text-sm text-navy-600">
            New firm?{' '}
            <Link to="/signup" className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500">
              Create an account
            </Link>
          </p>
        )}
        {needsCode && (
          <button
            type="button"
            className="w-full text-center text-sm text-accent-700 hover:underline"
            onClick={() => {
              setNeedsCode(false);
              setMfaCode('');
            }}
          >
            Use a different account
          </button>
        )}
      </form>
    </AuthLayout>
  );
}
