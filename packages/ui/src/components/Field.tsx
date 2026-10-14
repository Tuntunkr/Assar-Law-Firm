import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';

const control =
  'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-navy-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500';

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

function Wrapper({ id, label, error, hint, children }: FieldProps & { children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-navy-900">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-navy-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const describe = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({
  id,
  label,
  error,
  hint,
  className,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Wrapper {...{ id, label, error, hint }}>
      <input
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describe(id, error, hint)}
        {...rest}
        className={cn(control, error ? 'border-red-500' : 'border-navy-200', className)}
      />
    </Wrapper>
  );
}

export function TextAreaField({
  id,
  label,
  error,
  hint,
  className,
  ...rest
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Wrapper {...{ id, label, error, hint }}>
      <textarea
        id={id}
        rows={4}
        aria-invalid={!!error || undefined}
        aria-describedby={describe(id, error, hint)}
        {...rest}
        className={cn(control, error ? 'border-red-500' : 'border-navy-200', className)}
      />
    </Wrapper>
  );
}

export function SelectField({
  id,
  label,
  error,
  hint,
  className,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Wrapper {...{ id, label, error, hint }}>
      <select
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describe(id, error, hint)}
        {...rest}
        className={cn(control, error ? 'border-red-500' : 'border-navy-200', className)}
      >
        {children}
      </select>
    </Wrapper>
  );
}
