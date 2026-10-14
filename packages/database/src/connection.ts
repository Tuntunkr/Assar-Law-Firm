import mongoose from 'mongoose';

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: true });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** 1 = connected. Used by readiness checks. */
export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function syncIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export { mongoose };
