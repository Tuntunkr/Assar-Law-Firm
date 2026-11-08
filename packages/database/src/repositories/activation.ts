import type { Types } from 'mongoose';
import {
  CourtFormModel,
  CourtImportModel,
  DemoBookingModel,
  LocalMailboxModel,
  type CourtFormDoc,
  type CourtImportDoc,
} from '../models/index.js';

type Id = Types.ObjectId | string;

export const courtImports = {
  findKey: (organizationId: Id, sourceName: string, externalId: string) =>
    CourtImportModel.findOne({ organizationId, sourceName, externalId }).lean(),
  list: (organizationId: Id) =>
    CourtImportModel.find({ organizationId }).sort({ updatedAt: -1 }).limit(100).lean(),
  insert: (row: Omit<CourtImportDoc, '_id' | 'createdAt' | 'updatedAt'>) =>
    CourtImportModel.create(row),
  replace: (
    organizationId: Id,
    sourceName: string,
    externalId: string,
    patch: Partial<CourtImportDoc>,
  ) =>
    CourtImportModel.findOneAndUpdate(
      { organizationId, sourceName, externalId },
      patch,
      { returnDocument: 'after' },
    ).lean(),
};

export const localMailbox = {
  findByOutbox: (organizationId: Id, outboxId: Id) =>
    LocalMailboxModel.findOne({ organizationId, outboxId }).lean(),
  create: (row: {
    organizationId: Id;
    outboxId: Id;
    to: string;
    subject: string;
    body: string;
  }) => LocalMailboxModel.create({ ...row, status: 'held_local' as const }),
  list: (organizationId: Id) =>
    LocalMailboxModel.find({ organizationId }).sort({ createdAt: -1 }).limit(50).lean(),
};

export const demoBookings = {
  findSlot: (slotStart: Date) => DemoBookingModel.findOne({ slotStart }).lean(),
  taken: (from: Date, to: Date) =>
    DemoBookingModel.find({ slotStart: { $gte: from, $lt: to } })
      .select('slotStart')
      .lean(),
  create: (row: {
    name: string;
    email: string;
    firm: string;
    firmSize: string;
    message: string | null;
    slotStart: Date;
  }) =>
    DemoBookingModel.create({
      ...row,
      status: 'recorded_local' as const,
      notification: 'not_sent' as const,
    }),
};

export const courtForms = {
  list: (organizationId: Id) =>
    CourtFormModel.find({ organizationId }).sort({ _id: -1 }).limit(50).lean(),
  find: (organizationId: Id, id: Id) =>
    CourtFormModel.findOne({ _id: id, organizationId }).lean(),
  create: (row: Omit<CourtFormDoc, '_id' | 'createdAt' | 'updatedAt' | 'version' | 'status' | 'advocateDeclaration' | 'signoffNote' | 'decidedBy' | 'decidedAt' | 'licenseCheck'>) =>
    CourtFormModel.create({
      ...row,
      version: 1,
      status: 'draft',
      advocateDeclaration: false,
      signoffNote: null,
      decidedBy: null,
      decidedAt: null,
      licenseCheck: 'not_performed',
    }),
  saveDraft: (
    organizationId: Id,
    id: Id,
    patch: Partial<CourtFormDoc> & { version: number },
  ) =>
    CourtFormModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'draft' },
      patch,
      { returnDocument: 'after' },
    ).lean(),
  decide: (
    organizationId: Id,
    id: Id,
    patch: {
      status: 'legally_approved' | 'rejected';
      advocateDeclaration: boolean;
      signoffNote: string;
      decidedBy: Id;
      decidedAt: Date;
    },
  ) =>
    CourtFormModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'draft' },
      patch,
      { returnDocument: 'after' },
    ).lean(),
};
