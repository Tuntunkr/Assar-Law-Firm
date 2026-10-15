import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { passwordSchema } from '@assar/validation';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

type Errors = Partial<Record<'name' | 'password' | 'confirm', string>>;

export function AcceptInvitationPage() {
  const { client } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const firm = params.get('firm');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const loginHref = firm ? `/login?firm=${encodeURIComponent(firm)}` : '/login';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const next: Errors = {};
    if (name.length < 2) next.name = 'Enter your name';
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) next.password = 'Use at least 12 characters';
    if (password !== String(fd.get('confirm') ?? '')) next.confirm = 'The passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFailure(null);
    try {
      await client.acceptInvitation({ token, name, password });
      setDone(true);
    } catch (err) {
      setFailure(
        err instanceof ApiClientError && err.status === 404
          ? 'This invitation is invalid or has expired. Ask your law firm to send a new one.'
          : err instanceof ApiClientError
            ? err.message
            : 'Something went wrong. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Create your account</h1>
      {done ? (
        <div className="mt-6 space-y-4">
          <Alert tone="success">Your account is ready. You can now sign in.</Alert>
          <Link className="font-medium text-accent-700 underline" to={loginHref}>
            Go to sign in
          </Link>
        </div>
      ) : !token ? (
        <div className="mt-6">
          <Alert tone="error">
            This link is missing its invitation code. Open the link your law firm sent you.
          </Alert>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-6 space-y-4 rounded-xl border border-navy-100 bg-white p-6 shadow-sm"
          aria-label="Create your account"
        >
          {failure && <Alert tone="error">{failure}</Alert>}
          <TextField
            id="name"
            name="name"
            label="Your name"
            autoComplete="name"
            error={errors.name}
            required
          />
          <TextField
            id="password"
            name="password"
            type="password"
            label="Choose a password"
            hint="At least 12 characters."
            autoComplete="new-password"
            error={errors.password}
            required
          />
          <TextField
            id="confirm"
            name="confirm"
            type="password"
            label="Confirm password"
            autoComplete="new-password"
            error={errors.confirm}
            required
          />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      )}
    </div>
  );
}
