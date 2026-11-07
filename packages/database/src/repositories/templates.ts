import { extractPlaceholders } from '@assar/types';
import { DraftTemplateModel } from '../models/index.js';

type Id = string | { toString(): string };

interface NewTemplate {
  name: string;
  category: string;
  body: string;
  description?: string | null;
  starterKey?: string;
}

export const draftTemplates = {
  list: (organizationId: Id, o: { status: 'active' | 'archived'; category?: string }) =>
    DraftTemplateModel.find({
      organizationId: organizationId as never,
      status: o.status,
      ...(o.category ? { category: o.category } : {}),
    })
      .select('-body')
      .sort({ category: 1, nameLower: 1 })
      .limit(500)
      .lean(),
  count: (organizationId: Id) =>
    DraftTemplateModel.countDocuments({ organizationId: organizationId as never }),
  findById: (organizationId: Id, id: Id) =>
    DraftTemplateModel.findOne({
      _id: id as never,
      organizationId: organizationId as never,
    }).lean(),
  create: async (organizationId: Id, userId: Id, d: NewTemplate) =>
    (
      await DraftTemplateModel.create({
        organizationId: organizationId as never,
        name: d.name,
        nameLower: d.name.toLowerCase(),
        category: d.category,
        description: d.description ?? null,
        body: d.body,
        placeholders: extractPlaceholders(d.body),
        starterKey: d.starterKey ?? null,
        createdBy: userId as never,
        updatedBy: userId as never,
      })
    ).toObject(),
  /** Idempotent seeding of a shipped template (ignored if it already exists, even if renamed). */
  async seed(organizationId: Id, userId: Id, d: NewTemplate & { starterKey: string }) {
    try {
      await draftTemplates.create(organizationId, userId, d);
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // already there
    }
  },
  update: (
    organizationId: Id,
    id: Id,
    userId: Id,
    patch: {
      name?: string;
      category?: string;
      description?: string | null;
      body?: string;
      status?: 'active' | 'archived';
    },
  ) =>
    DraftTemplateModel.findOneAndUpdate(
      { _id: id as never, organizationId: organizationId as never },
      {
        $set: {
          ...patch,
          ...(patch.name ? { nameLower: patch.name.toLowerCase() } : {}),
          ...(patch.body !== undefined ? { placeholders: extractPlaceholders(patch.body) } : {}),
          updatedBy: userId as never,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
};
