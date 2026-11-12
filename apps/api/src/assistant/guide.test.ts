import { PERMISSIONS, type Permission } from '@assar/types';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { guideChunks, searchGuide } from './guide';

const ALL_BUT_BILLING_READ: Permission[] = PERMISSIONS.filter((p) => p !== 'billing:read');

describe('searchGuide', () => {
  it('routes an invoice how-to to help and hides it from a user without billing:read', () => {
    expect(classify('How do I issue an invoice?')).toBe('help');
    expect(searchGuide('issue an invoice', ['client:read'])).toBeNull();
  });

  it('returns the invoice chunk only when the caller can open billing', () => {
    const hit = searchGuide('issue an invoice', ['billing:read']);
    expect(hit?.id).toBe('invoices');
    expect(hit?.permission).toBe('billing:read');
    expect(searchGuide('issue an invoice', ['billing:write'])).toBeNull();
    expect(searchGuide('issue an invoice', ALL_BUT_BILLING_READ)).toBeNull();
  });

  it('drops closed chunks before scoring shared words', () => {
    expect(searchGuide('issue an invoice roster', ['client:read'])?.id).toBe('clients');
    expect(searchGuide('roster docket court parties', ['client:read'])?.id).toBe('clients');
    expect(searchGuide('roster docket court parties', ['client:read', 'matter:read'])?.id).toBe(
      'matters',
    );
  });

  it('returns null when no visible chunk shares a word', () => {
    expect(searchGuide('zzzzquantum', [...PERMISSIONS])).toBeNull();
    expect(searchGuide('calendar hearings', [])).toBeNull();
  });

  it('finds each dashboard module by its own words and permission', () => {
    const modules: { id: string; query: string; permission: Permission | null; only?: string }[] = [
      { id: 'dashboard', query: 'dashboard home', permission: null },
      { id: 'calendar', query: 'calendar hearings', permission: 'calendar:write', only: 'hearings' },
      { id: 'tasks', query: 'tasks due', permission: 'task:write', only: 'due' },
      { id: 'clients', query: 'clients roster', permission: 'client:read', only: 'roster' },
      { id: 'matters', query: 'matters docket', permission: 'matter:read', only: 'docket' },
      { id: 'documents', query: 'documents upload', permission: 'document:read', only: 'upload' },
      { id: 'templates', query: 'templates starters', permission: 'document:read', only: 'starters' },
      { id: 'ai', query: 'copilot chronology', permission: 'ai:use', only: 'chronology' },
      { id: 'conflicts', query: 'conflict adverse', permission: 'conflict:check', only: 'adverse' },
      { id: 'time', query: 'time duration', permission: 'time:write', only: 'duration' },
      { id: 'invoices', query: 'issue an invoice', permission: 'billing:read', only: 'invoice' },
      { id: 'reports', query: 'reports balances', permission: 'billing:read', only: 'balances' },
      { id: 'team', query: 'team invitations', permission: 'user:manage', only: 'invitations' },
      { id: 'audit', query: 'audit sensitive', permission: 'audit:read', only: 'sensitive' },
      { id: 'settings', query: 'settings preferences', permission: null },
    ];

    expect(guideChunks.map((chunk) => chunk.id)).toEqual(modules.map((mod) => mod.id));

    for (const mod of modules) {
      const granted = mod.permission ? [mod.permission] : [];
      const hit = searchGuide(mod.query, granted);
      expect(hit?.id).toBe(mod.id);
      expect(hit?.title).toBeTruthy();
      expect(hit?.permission).toBe(mod.permission);
      const words = hit?.text.split(/\s+/).filter(Boolean) ?? [];
      expect(words.length).toBeGreaterThan(0);
      expect(words.length).toBeLessThan(120);
      if (mod.only) expect(searchGuide(mod.only, [])).toBeNull();
    }
  });

  it('keeps invoice wording out of chunks a non-billing user can still open', () => {
    const reserved = new Set(['issue', 'an', 'invoice']);
    for (const chunk of guideChunks) {
      if (chunk.id === 'invoices') continue;
      const words = `${chunk.title} ${chunk.text}`.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      for (const word of words) expect(reserved.has(word)).toBe(false);
    }
  });
});
