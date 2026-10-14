import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { sha256 } from '../common/crypto';

const PERIOD = 30;

@Injectable()
export class TotpService {
  generateSecret(): string {
    return new OTPAuth.Secret({ size: 20 }).base32;
  }

  uri(email: string, base32Secret: string): string {
    return this.totp(base32Secret, email).toString();
  }

  /** Returns the matched time-step, or null. Callers must reject steps <= the last used one (replay). */
  verify(base32Secret: string, code: string): number | null {
    const delta = this.totp(base32Secret).validate({ token: code, window: 1 });
    if (delta === null) return null;
    return Math.floor(Date.now() / 1000 / PERIOD) + delta;
  }

  /** Test helper and enrollment tooling. */
  generate(base32Secret: string, timestamp = Date.now()): string {
    return this.totp(base32Secret).generate({ timestamp });
  }

  newRecoveryCodes(count = 8): { plain: string[]; hashes: string[] } {
    const plain = Array.from({ length: count }, () => {
      const h = randomBytes(5).toString('hex');
      return `${h.slice(0, 5)}-${h.slice(5)}`;
    });
    return { plain, hashes: plain.map(normalizeRecovery).map(sha256) };
  }

  hashRecovery(code: string): string {
    return sha256(normalizeRecovery(code));
  }

  private totp(base32Secret: string, label = 'user') {
    return new OTPAuth.TOTP({
      issuer: 'Assar Law Firm',
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
  }
}

export const normalizeRecovery = (c: string) => c.trim().toLowerCase().replace(/\s/g, '');
export const looksLikeRecovery = (c: string) => /[-a-f]/i.test(c) && c.length > 6;
