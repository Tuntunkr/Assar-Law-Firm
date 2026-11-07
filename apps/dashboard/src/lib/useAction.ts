import { ApiClientError } from '@assar/api-client';
import { useCallback, useState } from 'react';
import { useNotify } from '../components/notify';

/** Field errors by dotted path, from the API's validation issues. */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiClientError && Array.isArray(e.details)) {
    for (const d of e.details as { path?: (string | number)[]; message?: string }[]) {
      const key = d.path?.join('.') ?? '';
      if (key && d.message && !out[key]) out[key] = d.message;
    }
  }
  return out;
}

export const errorText = (e: unknown) =>
  e instanceof ApiClientError
    ? e.requestId
      ? `${e.message} (ref ${e.requestId.slice(0, 8)})`
      : e.message
    : 'Something went wrong. Please try again.';

/**
 * Runs a mutation with a busy flag, a success toast and an error toast. Field-level validation issues
 * are returned in `errors` so a form can show them next to the inputs.
 */
export function useAction() {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const run = useCallback(
    async <T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      setErrors({});
      try {
        const r = await fn();
        if (success) notify('success', success);
        return r;
      } catch (e) {
        const f = fieldErrors(e);
        setErrors(f);
        notify(
          'error',
          Object.keys(f).length ? 'Please fix the highlighted fields.' : errorText(e),
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  return { run, busy, errors, clearErrors: () => setErrors({}) };
}
