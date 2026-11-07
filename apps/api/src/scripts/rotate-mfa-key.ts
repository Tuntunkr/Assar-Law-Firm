import { UserModel, connectDatabase, disconnectDatabase } from '@assar/database';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { loadEnv } from '../config/env';

export interface RotationSummary {
  scanned: number;
  rotated: number;
  alreadyCurrent: number;
  /** Secrets that neither key can decrypt. Left untouched; investigate before removing the old key. */
  failed: string[];
  dryRun: boolean;
}

/**
 * Re-encrypts every stored TOTP secret under `current`. Safe to repeat. Run it with MFA_ENCRYPTION_KEY set to the
 * new key and MFA_ENCRYPTION_KEY_PREVIOUS to the old one; once it reports no failures, drop the old key.
 */
export async function rotateMfaKeys(o: {
  current: string;
  previous?: string;
  dryRun?: boolean;
}): Promise<RotationSummary> {
  const summary: RotationSummary = {
    scanned: 0,
    rotated: 0,
    alreadyCurrent: 0,
    failed: [],
    dryRun: !!o.dryRun,
  };
  const cursor = UserModel.find({
    $or: [{ 'mfa.secretEnc': { $ne: null } }, { 'mfa.pendingSecretEnc': { $ne: null } }],
  }).cursor();

  for await (const user of cursor) {
    summary.scanned++;
    const patch: Record<string, string> = {};
    let bad = false;
    for (const field of ['secretEnc', 'pendingSecretEnc'] as const) {
      const stored = user.mfa[field];
      if (!stored) continue;
      try {
        decryptSecret(stored, o.current);
        continue; // already under the current key
      } catch {
        /* try the previous key */
      }
      try {
        if (!o.previous) throw new Error('no previous key');
        patch[`mfa.${field}`] = encryptSecret(decryptSecret(stored, o.previous), o.current);
      } catch {
        bad = true;
      }
    }
    if (bad) summary.failed.push(String(user._id));
    else if (Object.keys(patch).length === 0) summary.alreadyCurrent++;
    else {
      if (!o.dryRun) await UserModel.updateOne({ _id: user._id }, { $set: patch });
      summary.rotated++;
    }
  }
  return summary;
}

/** `node dist/scripts/rotate-mfa-key.js [--dry-run]` */
async function main() {
  const env = loadEnv();
  await connectDatabase(env.MONGODB_URI);
  try {
    const summary = await rotateMfaKeys({
      current: env.MFA_ENCRYPTION_KEY,
      previous: env.MFA_ENCRYPTION_KEY_PREVIOUS,
      dryRun: process.argv.includes('--dry-run'),
    });
    console.log(JSON.stringify(summary)); // counts and ids only; never secrets
    if (summary.failed.length) process.exitCode = 2;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
