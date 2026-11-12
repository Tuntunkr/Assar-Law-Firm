import type { Permission } from '@assar/types';
import type { IconName } from '../components/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  perm?: Permission;
}
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Main',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/ask', label: 'Ask Assar', icon: 'ai', perm: 'assistant:use' },
      { to: '/calendar', label: 'Calendar', icon: 'calendar', perm: 'calendar:write' },
      { to: '/tasks', label: 'Tasks', icon: 'tasks', perm: 'task:write' },
    ],
  },
  {
    group: 'Legal',
    items: [
      { to: '/clients', label: 'Clients', icon: 'clients', perm: 'client:read' },
      { to: '/matters', label: 'Matters', icon: 'matters', perm: 'matter:read' },
      { to: '/documents', label: 'Documents', icon: 'documents', perm: 'document:read' },
      { to: '/templates', label: 'Templates', icon: 'documents', perm: 'document:read' },
      { to: '/conflicts', label: 'Conflict check', icon: 'conflicts', perm: 'conflict:check' },
    ],
  },
  {
    group: 'Billing',
    items: [
      { to: '/time', label: 'Time tracking', icon: 'time', perm: 'time:write' },
      { to: '/invoices', label: 'Invoices', icon: 'invoices', perm: 'billing:read' },
      { to: '/reports', label: 'Reports', icon: 'reports', perm: 'billing:read' },
    ],
  },
  {
    group: 'Firm',
    items: [
      { to: '/team', label: 'Team', icon: 'team', perm: 'user:manage' },
      { to: '/audit', label: 'Audit log', icon: 'audit', perm: 'audit:read' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const FLAT = NAV.flatMap((g) => g.items);
/** Page title for the top bar. */
export function titleFor(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  const hit = FLAT.filter(
    (i) => i.to !== '/' && (pathname === i.to || pathname.startsWith(`${i.to}/`)),
  ).sort((a, b) => b.to.length - a.to.length)[0];
  if (hit) return hit.label;
  if (pathname === '/mfa-setup') return 'Security';
  if (pathname === '/profile') return 'My profile';
  return 'Assar';
}
