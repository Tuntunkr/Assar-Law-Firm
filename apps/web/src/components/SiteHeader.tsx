'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ButtonLink, Container } from '@assar/ui';
import { nav, site } from '@/content/site';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/90 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight text-navy-900">
          {site.name}
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-navy-700 hover:text-navy-950"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-navy-700 hover:text-navy-950">
            Login
          </Link>
          <ButtonLink href="/contact">Demo</ButtonLink>
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-navy-200 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </Container>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-navy-100 bg-white lg:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {[...nav, { href: '/login', label: 'Login' }].map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-base font-medium text-navy-800 hover:bg-navy-50"
              >
                {n.label}
              </Link>
            ))}
            <ButtonLink href="/contact" className="mt-2" onClick={() => setOpen(false)}>
              Demo
            </ButtonLink>
          </Container>
        </nav>
      )}
    </header>
  );
}
