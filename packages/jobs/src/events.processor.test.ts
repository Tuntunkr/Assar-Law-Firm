import { describe, expect, it } from 'vitest';
import { eventSlug, eventUrl, signEvent } from './events.processor.js';

describe('event delivery', () => {
  it('maps every event name to a dash-separated webhook path', () => {
    expect(eventSlug('matter.created')).toBe('matter-created');
    expect(eventSlug('document.scan_clean')).toBe('document-scan-clean');
    expect(eventSlug('ai.output_ready')).toBe('ai-output-ready');
  });
  it('appends the path to the configured base, tolerating trailing slashes', () => {
    expect(eventUrl('https://n8n.example.com/webhook/assar', 'ai.output_ready')).toBe(
      'https://n8n.example.com/webhook/assar/ai-output-ready',
    );
    expect(eventUrl('https://n8n.example.com/webhook/assar//', 'matter.created')).toBe(
      'https://n8n.example.com/webhook/assar/matter-created',
    );
  });
  it('signs timestamp and body so a replayed or altered payload fails verification', () => {
    const sig = signEvent('secret-secret-secret', '1700000000', '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signEvent('secret-secret-secret', '1700000001', '{"a":1}')).not.toBe(sig);
    expect(signEvent('secret-secret-secret', '1700000000', '{"a":2}')).not.toBe(sig);
    expect(signEvent('other-secret-secret!', '1700000000', '{"a":1}')).not.toBe(sig);
  });
});
