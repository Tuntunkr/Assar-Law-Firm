import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fieldErrors } from '../lib/useAction';
import { AuthLayout } from './AuthLayout';

/** Creates a firm and its owner account. The owner then enrolls in MFA before anything else works. */
export function SignupPage() {
  const { state, register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({
    organizationName: '',
    name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'authed') return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setErrors({});
    setBusy(true);
    try {
      await register({
        organizationName: f.organizationName,
        name: f.name,
        email: f.email,
        password: f.password,
      });
      navigate('/mfa-setup', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Create your firm account</h1>
          <p className="mt-1 text-sm text-navy-600">
            You will be the firm's owner. You can invite your team afterwards.
          </p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField
          id="firm"
          label="Firm name"
          value={f.organizationName}
          onChange={set('organizationName')}
          error={errors.organizationName}
          required
        />
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
          id="email"
          label="Work email"
          type="email"
          autoComplete="username"
          value={f.email}
          onChange={set('email')}
          error={errors.email}
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
          Create account
        </Button>
        <p className="text-center text-sm text-navy-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
