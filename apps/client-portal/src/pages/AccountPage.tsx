import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { passwordSchema } from '@assar/validation';
import { useState, type FormEvent } from 'react';
import { useNotify } from '../components/notify';
import { useAuth } from '../lib/auth';

type Errors = Partial<Record<'currentPassword' | 'newPassword' | 'confirm', string>>;

export function AccountPage() {
  const { state, client } = useAuth();
  const notify = useNotify();
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== 'authed') return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const currentPassword = String(fd.get('currentPassword') ?? '');
    const newPassword = String(fd.get('newPassword') ?? '');
    const next: Errors = {};
    if (!currentPassword) next.currentPassword = 'Enter your current password';
    if (!passwordSchema.safeParse(newPassword).success)
      next.newPassword = 'Use at least 12 characters';
    if (newPassword !== String(fd.get('confirm') ?? ''))
      next.confirm = 'The passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFailure(null);
    try {
      await client.changePassword({ currentPassword, newPassword });
      form.reset();
      notify('success', 'Your password was changed. Other devices have been signed out.');
    } catch (err) {
      setFailure(
        err instanceof ApiClientError && err.status === 403
          ? 'Your current password is not correct.'
          : err instanceof ApiClientError
            ? err.message
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Your account</h1>
      <dl className="mt-4 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-navy-600">Name</dt>
        <dd>{state.me.clientUser.name}</dd>
        <dt className="text-navy-600">Email</dt>
        <dd>{state.me.clientUser.email}</dd>
        <dt className="text-navy-600">Client</dt>
        <dd>{state.me.client.name}</dd>
      </dl>
      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-8 max-w-md space-y-4 rounded-xl border border-navy-100 bg-white p-6 shadow-sm"
        aria-label="Change password"
      >
        <h2 className="text-lg font-semibold text-navy-900">Change password</h2>
        {failure && <Alert tone="error">{failure}</Alert>}
        <TextField
          id="currentPassword"
          name="currentPassword"
          type="password"
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword}
          required
        />
        <TextField
          id="newPassword"
          name="newPassword"
          type="password"
          label="New password"
          hint="At least 12 characters."
          autoComplete="new-password"
          error={errors.newPassword}
          required
        />
        <TextField
          id="confirm"
          name="confirm"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirm}
          required
        />
        <Button type="submit" loading={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </>
  );
}
