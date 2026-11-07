import type { INestApplication } from '@nestjs/common';
import { UserModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/common/crypto';
import { rotateMfaKeys } from '../src/scripts/rotate-mfa-key';
import { PASSWORD, bootApp, login, registerWithMfa, totp } from './helpers';

const OLD = 'old-mfa-encryption-key-0123456789-ABCDEFG';
const NEW = 'testing-mfa-encryption-key-test-mfa-key-v2';
let app: INestApplication;
beforeAll(async () => {
  app = await bootApp({ MFA_ENCRYPTION_KEY: NEW, MFA_ENCRYPTION_KEY_PREVIOUS: OLD });
});
afterAll(async () => {
  await app.close();
});

describe('MFA key rotation', () => {
  it('keeps users signing in while secrets are still under the old key, then re-encrypts them', async () => {
    const owner = await registerWithMfa(app);
    // Simulate a secret that was enrolled before the key changed.
    const before = await UserModel.findOne({ email: owner.email });
    const stored = before!.mfa.secretEnc!;
    expect(() => decryptSecret(stored, OLD)).toThrow(); // enrolled under the new key
    await UserModel.updateOne(
      { email: owner.email },
      { $set: { 'mfa.secretEnc': encryptSecret(owner.secret, OLD), 'mfa.lastUsedStep': null } },
    );

    // The previous key is still accepted, so nobody is locked out mid-rotation.
    const next = totp.generate(owner.secret, Date.now() + 30_000);
    expect((await login(app, owner.email, PASSWORD, next)).res.status).toBe(200);

    const dry = await rotateMfaKeys({ current: NEW, previous: OLD, dryRun: true });
    expect(dry).toMatchObject({ rotated: 1, dryRun: true, failed: [] });
    expect(
      decryptSecret((await UserModel.findOne({ email: owner.email }))!.mfa.secretEnc!, OLD),
    ).toBe(owner.secret); // dry run changed nothing

    const done = await rotateMfaKeys({ current: NEW, previous: OLD });
    expect(done).toMatchObject({ rotated: 1, failed: [] });
    const after = (await UserModel.findOne({ email: owner.email }))!.mfa.secretEnc!;
    expect(decryptSecret(after, NEW)).toBe(owner.secret);
    expect(() => decryptSecret(after, OLD)).toThrow(); // the old key no longer opens anything

    // Idempotent. And the user can still sign in with the secret now stored under the new key
    // (the replay guard is cleared so the same code can be tried again).
    expect(await rotateMfaKeys({ current: NEW, previous: OLD })).toMatchObject({
      rotated: 0,
      alreadyCurrent: 1,
    });
    await UserModel.updateOne({ email: owner.email }, { $set: { 'mfa.lastUsedStep': null } });
    expect((await login(app, owner.email, PASSWORD, next)).res.status).toBe(200);
  });

  it('reports secrets neither key can open and leaves them untouched', async () => {
    const owner = await registerWithMfa(app);
    const lost = encryptSecret(owner.secret, 'a-key-nobody-has-any-more-0123456789ab');
    await UserModel.updateOne({ email: owner.email }, { $set: { 'mfa.secretEnc': lost } });
    const summary = await rotateMfaKeys({ current: NEW, previous: OLD });
    expect(summary.failed).toHaveLength(1);
    expect((await UserModel.findOne({ email: owner.email }))!.mfa.secretEnc).toBe(lost);
    expect(JSON.stringify(summary)).not.toContain(owner.secret);
  });
});
