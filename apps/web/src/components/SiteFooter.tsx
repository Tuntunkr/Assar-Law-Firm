import Link from 'next/link';
import { Container } from '@assar/ui';
import { footerLinks, site } from '@/content/site';

export function SiteFooter() {
  return (
    <footer className="bg-navy-950 text-navy-200">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-lg font-semibold text-white">{site.name}</p>
          <p className="mt-3 text-sm">{site.tagline}</p>
        </div>
        {footerLinks.map((g) => (
          <div key={g.title}>
            <p className="text-sm font-semibold text-white">{g.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="border-t border-navy-800 py-6 text-xs">
        © {new Date().getFullYear()} {site.name}. AI output is an unverified draft and is not legal
        advice.
      </Container>
    </footer>
  );
}
