import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootApp, newClient, newMatter, post, registerWithMfa } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp({ AI_ENABLED: 'false' });
});
afterAll(async () => {
  await app.close();
});

describe('AI disabled', () => {
  it('refuses to create AI jobs and does not queue anything', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const matter = await newMatter(owner, await newClient(owner));
    const res = await post(attorney, '/v1/ai/jobs', {
      task: 'summary',
      matterId: matter.id,
      documents: [{ documentId: 'a'.repeat(24) }],
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'AI features are not enabled',
    });
    expect((await owner.agent.get('/v1/system/workers').expect(200)).body.aiEnabled).toBe(false);
  });
});
