import { z } from 'zod';

const multipartBoolean = (defaultValue: boolean) =>
  z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').default(defaultValue);

export const createPhotoPostSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  allowDownload: multipartBoolean(true),
});

export const updatePhotoPostSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  allowDownload: z.boolean().optional(),
});

export const createTextPostSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  backgroundStyle: z.string().trim().max(50).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});

export const updateTextPostSchema = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
  backgroundStyle: z.string().trim().max(50).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

export const flatCommentSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const createStorySchema = z.object({
  mediaType: z.enum(['PHOTO', 'VIDEO']),
  caption: z.string().trim().max(200).optional(),
});

export const storyReplySchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const createAddYoursSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});
