import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';

/** Split-screen frame shared by sign-in, sign-up and accept-invitation. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-[#0b1220] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500">
            <Icon name="scale" size={18} />
          </span>
          <p className="text-xl font-semibold tracking-tight">Assar</p>
        </div>
        <div>
          <p className="max-w-md text-3xl font-semibold leading-tight">
            Matters, documents, time and billing — in one place your whole firm can trust.
          </p>
          <p className="mt-4 max-w-md text-sm text-slate-400">
            AI output is always a draft until an attorney reviews it. Sessions are protected with
            multi-factor authentication.
          </p>
        </div>
        <p className="text-xs text-slate-500">© Assar</p>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
