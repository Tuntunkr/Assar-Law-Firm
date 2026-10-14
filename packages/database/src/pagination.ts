import type { Types } from 'mongoose';
import { mongoose } from './connection.js';

export function encodeCursor(id: Types.ObjectId | string): string {
  return Buffer.from(String(id)).toString('base64url');
}

/** Returns null for a missing or malformed cursor so callers can reject it. */
export function decodeCursor(cursor: string | undefined): Types.ObjectId | null | undefined {
  if (!cursor) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString();
  return mongoose.isValidObjectId(raw) && raw.length === 24
    ? new mongoose.Types.ObjectId(raw)
    : null;
}

export function toPage<T extends { _id: Types.ObjectId }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, page: { nextCursor: hasMore && last ? encodeCursor(last._id) : null, limit } };
}
