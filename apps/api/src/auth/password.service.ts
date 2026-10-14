import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP-recommended Argon2id baseline.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified when the account doesn't exist so response time doesn't reveal it. */
  private dummyHash: Promise<string> = argon2.hash('not-a-real-password', OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
