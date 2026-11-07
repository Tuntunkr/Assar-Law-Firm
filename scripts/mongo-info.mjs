// Small helper for the backup scripts (uses the `mongodb` driver already installed for packages/database).
// Commands (connection string from MONGODB_URI):
//   mac <file>            print the HMAC of an encrypted backup (needs BACKUP_PASSPHRASE, not the database)
//   db                    print the database name in the URI
//   total                 print the total number of documents in that database
//   counts                print {createdAt, database, collections:{name:count}} as JSON
//   with-db <name>        print the URI with the database replaced
//   compare <manifest>    exit 0 if every collection count matches the manifest, else print differences and exit 1
//   drop                  drop the database
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const [cmd, arg] = process.argv.slice(2);

// mac <file>: HMAC-SHA256 of the encrypted backup, keyed from the passphrase (PBKDF2). Plain AES-CBC is not
// authenticated, so without this a modified backup could be restored; with it, only someone holding the
// passphrase can produce a file that verifies. Needs no database.
if (cmd === 'mac') {
  const { createHmac, pbkdf2Sync } = await import('node:crypto');
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!pass) {
    console.error('BACKUP_PASSPHRASE is not set');
    process.exit(1);
  }
  const key = pbkdf2Sync(pass, 'assar-backup-mac-v1', 600000, 32, 'sha256');
  console.log(createHmac('sha256', key).update(readFileSync(arg)).digest('hex'));
  process.exit(0);
}
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const u = new URL(uri);
const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
if (cmd === 'db') {
  if (!dbName) {
    console.error('MONGODB_URI must include a database name');
    process.exit(1);
  }
  console.log(dbName);
  process.exit(0);
}
if (cmd === 'with-db') {
  u.pathname = `/${arg}`;
  console.log(u.toString());
  process.exit(0);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db(dbName);
  const counts = async () => {
    const out = {};
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (c.name.startsWith('system.')) continue;
      out[c.name] = await db.collection(c.name).countDocuments({});
    }
    return out;
  };
  if (cmd === 'total') console.log(Object.values(await counts()).reduce((a, b) => a + b, 0));
  else if (cmd === 'counts')
    console.log(
      JSON.stringify(
        { createdAt: new Date().toISOString(), database: dbName, collections: await counts() },
        null,
        2,
      ),
    );
  else if (cmd === 'drop') await db.dropDatabase();
  else if (cmd === 'compare') {
    const want = JSON.parse(readFileSync(arg, 'utf8')).collections;
    const got = await counts();
    const bad = [];
    for (const name of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if ((want[name] ?? 0) !== (got[name] ?? 0))
        bad.push(`${name}: backup manifest ${want[name] ?? 0}, restored ${got[name] ?? 0}`);
    }
    if (bad.length) {
      console.error('MISMATCH\n' + bad.join('\n'));
      process.exitCode = 1;
    } else
      console.log(
        `OK: ${Object.keys(want).length} collections, ${Object.values(want).reduce((a, b) => a + b, 0)} documents restored and verified`,
      );
  } else {
    console.error('unknown command');
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
