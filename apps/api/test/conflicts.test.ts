import type { INestApplication } from '@nestjs/common';
import { ConflictCheckModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootApp, newClient, newMatter, post, registerWithMfa } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

async function seed() {
  const owner = await registerWithMfa(app);
  const alice = await addMember(app, owner, 'attorney');
  const bob = await addMember(app, owner, 'attorney');
  const clientId = await newClient(owner, 'Acme Holdings LLC');
  const open = await newMatter(owner, clientId, { title: 'Open Matter' });
  await post(owner, `/v1/matters/${open.id}/parties`, {
    name: 'John A. Smith',
    type: 'individual',
    role: 'opposing_party',
  }).expect(201);
  const secret = await newMatter(alice, clientId, {
    title: 'Confidential Matter',
    restricted: true,
  });
  await post(alice, `/v1/matters/${secret.id}/parties`, {
    name: 'Globex Corporation',
    type: 'organization',
    role: 'opposing_party',
  }).expect(201);
  return { owner, alice, bob, clientId, open, secret };
}

const check = (m: Parameters<typeof post>[0], names: string[]) =>
  post(m, '/v1/conflict-checks', { names });

describe('conflict checks', () => {
  it('finds exact and similar matches across clients and parties', async () => {
    const { owner, clientId, open } = await seed();
    const res = await check(owner, [
      'ACME holdings, inc.',
      'Smith John',
      'John Smith',
      'Nobody Known',
    ]).expect(200);
    const [acme, smithJohn, johnSmith, nobody] = res.body.results;

    expect(acme.matches).toHaveLength(1);
    expect(acme.matches[0]).toMatchObject({
      matchType: 'exact',
      source: 'client',
      clientId,
      restricted: false,
    });
    expect(smithJohn.matches[0]).toMatchObject({
      matchType: 'similar',
      source: 'party',
      name: 'John A. Smith',
      matterId: open.id,
      partyRole: 'opposing_party',
    });
    expect(johnSmith.matches[0].matchType).toBe('similar');
    expect(nobody.matches).toEqual([]);
    expect(res.body.notice).toMatch(/not a substitute for attorney review/);
  });

  it('does not match on a single shared word', async () => {
    const { owner } = await seed();
    const res = await check(owner, ['John Brown', 'Acme']).expect(200);
    expect(res.body.results[0].matches).toEqual([]);
    expect(res.body.results[1].matches).toEqual([]); // "Acme" vs "Acme Holdings": single-word names match exactly only
  });

  it('flags conflicts in restricted matters without revealing details to outsiders', async () => {
    const { owner, alice, bob, secret } = await seed();

    const outsider = (await check(bob, ['Globex Corporation']).expect(200)).body.results[0].matches;
    expect(outsider).toEqual([{ matchType: 'exact', source: 'party', restricted: true }]);
    expect(JSON.stringify(outsider)).not.toMatch(/Globex|Confidential|M-\d{4}/);

    for (const insider of [alice, owner]) {
      const m = (await check(insider, ['Globex Corporation']).expect(200)).body.results[0]
        .matches[0];
      expect(m).toMatchObject({
        restricted: false,
        name: 'Globex Corporation',
        matterId: secret.id,
        matterTitle: 'Confidential Matter',
      });
    }
  });

  it('is scoped to the caller’s organization', async () => {
    await seed();
    const other = await registerWithMfa(app, 'Other');
    const res = await check(other, ['Acme Holdings', 'John A. Smith', 'Globex Corporation']).expect(
      200,
    );
    expect(res.body.results.every((r: { matches: unknown[] }) => r.matches.length === 0)).toBe(
      true,
    );
  });

  it('enforces permission and validates input', async () => {
    const { owner } = await seed();
    const staff = await addMember(app, owner, 'staff');
    const billing = await addMember(app, owner, 'billing');
    expect((await check(staff, ['Anyone Here'])).status).toBe(403);
    expect((await check(billing, ['Anyone Here'])).status).toBe(403);
    expect((await check(owner, [])).status).toBe(400);
    expect(
      (
        await check(
          owner,
          Array.from({ length: 21 }, (_, i) => `Name Number ${i}`),
        )
      ).status,
    ).toBe(400);
    expect((await check(owner, ['x'])).status).toBe(400);
  });

  it('records each check and audits it without storing the names in the audit log', async () => {
    const { owner } = await seed();
    const before = await ConflictCheckModel.countDocuments();
    await check(owner, ['Audit Probe Person']).expect(200);
    expect(await ConflictCheckModel.countDocuments()).toBe(before + 1);
    const logs = await owner.agent.get('/v1/audit-logs?action=conflict.checked').expect(200);
    expect(logs.body.data[0].meta).toMatchObject({ names: 1, matchCount: 0 });
    expect(JSON.stringify(logs.body)).not.toContain('Audit Probe');
  });
});
