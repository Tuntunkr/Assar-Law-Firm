// Idempotently initiates the single-node replica set (uses the `mongodb` driver from packages/database).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { MongoClient } = require('mongodb');

const port = process.env.MONGO_PORT ?? '27117';
const host = `127.0.0.1:${port}`;
const client = new MongoClient(`mongodb://${host}/?directConnection=true`, {
  serverSelectionTimeoutMS: 15000,
});
await client.connect();
try {
  await client.db('admin').command({ replSetGetStatus: 1 });
} catch {
  await client.db('admin').command({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] },
  });
}
for (let i = 0; i < 40; i++) {
  const hello = await client.db('admin').command({ hello: 1 });
  if (hello.isWritablePrimary) break;
  await new Promise((r) => setTimeout(r, 500));
}
await client.close();
