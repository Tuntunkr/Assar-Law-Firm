import Link from 'next/link';
import { footerLinks, site } from '@/content/site';

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-xl">{site.name}</p>
          <p className="mt-3 max-w-[28ch] text-sm leading-relaxed text-[var(--muted)]">
            {site.tagline}
          </p>
          <a className="mt-3 inline-block text-sm underline" href={`mailto:${site.contactEmail}`}>
            {site.contactEmail}
          </a>
        </div>
        {footerLinks.map((group) => (
          <div key={group.title}>
            <p className="text-sm text-[var(--ink)]">{group.title}</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-[var(--ink)]">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-6 text-xs text-[var(--muted)] sm:px-8">
        © {new Date().getFullYear()} {site.name}. AI output is an unverified draft and is not legal
        advice.
      </div>
    </footer>
  );
}
