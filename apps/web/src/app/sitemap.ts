import type { MetadataRoute } from 'next';
import { productPages } from '@/content/services';
import { site } from '@/content/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '',
    '/services',
    '/solutions',
    '/pricing',
    '/about',
    '/contact',
    '/faq',
    ...Object.keys(productPages).map((p) => `/${p}`),
  ];
  return paths.map((p) => ({ url: `${site.url}${p}` }));
}
