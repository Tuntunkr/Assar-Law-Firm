import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The whole monorepo's tests run in parallel; the default 1s wait is too tight on a busy machine.
configure({ asyncUtilTimeout: 8000 });

// jsdom has no <dialog> modal support; this is enough for the dialog contents to be queryable.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
