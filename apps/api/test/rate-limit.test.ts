import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, uniqueEmail } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp({ AUTH_RATE_LIMIT_PER_MIN: '3' });
});
afterAll(async () => {
  await app.close();
});

describe('rate limiting', () => {
  it('throttles auth endpoints per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'whatever-password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
