'use client';

import Link from 'next/link';
import { useState } from 'react';
import { nav, site } from '@/content/site';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-[var(--surface)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="font-display text-xl tracking-tight text-[var(--ink)]">
          {site.name}
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-5 lg:flex">
          <Link href="/login" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
            Login
          </Link>
          <Link href="/contact" className="site-btn">
            Book a demo
          </Link>
        </div>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center border border-[var(--line)] lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? 'Close' : 'Menu'}</span>
          <span aria-hidden="true" className="text-lg leading-none">
            {open ? '×' : '☰'}
          </span>
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-[var(--line)] lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4">
            {[...nav, { href: '/login', label: 'Login' }].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="px-1 py-2 text-base text-[var(--ink)]"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/contact" className="site-btn mt-3" onClick={() => setOpen(false)}>
              Book a demo
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
