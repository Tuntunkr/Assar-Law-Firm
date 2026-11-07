import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fieldErrors } from '../lib/useAction';
import { AuthLayout } from './AuthLayout';

/** A teammate opens the invitation link (`/invite?token=…`) and sets their name and password. */
export function AcceptInvitePage() {
  const { client } = useAuth();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    token: params.get('token') ?? '',
    name: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setErrors({});
    setBusy(true);
    try {
      await client.acceptInvitation({ token: f.token.trim(), name: f.name, password: f.password });
      setDone(true);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <AuthLayout>
        <div className="w-full max-w-sm space-y-4">
          <Alert tone="success">Your account is ready.</Alert>
          <Link
            to="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent-600 text-sm font-semibold text-white hover:bg-accent-700"
          >
            Continue to sign in
          </Link>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Join your firm</h1>
          <p className="mt-1 text-sm text-navy-600">
            Set your name and a password to accept the invitation.
          </p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!params.get('token') && (
          <TextField
            id="token"
            label="Invitation token"
            value={f.token}
            onChange={set('token')}
            error={errors.token}
            required
          />
        )}
        <TextField
          id="name"
          label="Your name"
          autoComplete="name"
          value={f.name}
          onChange={set('name')}
          error={errors.name}
          required
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
          value={f.password}
          onChange={set('password')}
          error={errors.password}
          required
        />
        <TextField
          id="confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={f.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          required
        />
        <Button type="submit" loading={busy} className="w-full">
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}
