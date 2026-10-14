'use client';

import { useState } from 'react';
import { Alert, Button, SelectField, TextAreaField, TextField } from '@assar/ui';
import { demoRequestSchema } from '@assar/validation';

type Errors = Partial<Record<string, string>>;
type State =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok' } | { kind: 'error'; message: string };

export function DemoForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = demoRequestSchema.safeParse({
      name: fd.get('name'),
      email: fd.get('email'),
      firm: fd.get('firm'),
      firmSize: fd.get('firmSize'),
      message: fd.get('message') || undefined,
      consent: fd.get('consent') === 'on',
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setState({
          kind: 'error',
          message: body?.error?.message ?? 'Something went wrong. Please try again.',
        });
        return;
      }
      setState({ kind: 'ok' });
    } catch {
      setState({
        kind: 'error',
        message: 'Network error. Please check your connection and try again.',
      });
    }
  }

  if (state.kind === 'ok') {
    return <Alert tone="success">Thanks — your request was received. We will be in touch.</Alert>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Book a demo">
      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="name"
          name="name"
          label="Full name"
          autoComplete="name"
          error={errors.name}
          required
        />
        <TextField
          id="email"
          name="email"
          type="email"
          label="Work email"
          autoComplete="email"
          error={errors.email}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="firm"
          name="firm"
          label="Firm name"
          autoComplete="organization"
          error={errors.firm}
          required
        />
        <SelectField
          id="firmSize"
          name="firmSize"
          label="Firm size"
          defaultValue=""
          error={errors.firmSize}
          required
        >
          <option value="" disabled>
            Select…
          </option>
          {['1-5', '6-20', '21-50', '51-200', '200+'].map((s) => (
            <option key={s} value={s}>
              {s} people
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField
        id="message"
        name="message"
        label="What would you like to see? (optional)"
        hint="Please do not include confidential client information."
        error={errors.message}
      />
      <div>
        <label className="flex items-start gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            name="consent"
            className="mt-1"
            aria-describedby={errors.consent ? 'consent-error' : undefined}
          />
          I agree to be contacted about this request.
        </label>
        {errors.consent && (
          <p id="consent-error" role="alert" className="mt-1 text-xs font-medium text-red-700">
            {errors.consent}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" loading={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Sending…' : 'Request a demo'}
      </Button>
    </form>
  );
}
