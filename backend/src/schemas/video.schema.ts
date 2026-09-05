import { z } from 'zod';

// multipart/form-data text fields always arrive as strings, so this
// validates req.body *after* multer has parsed the upload.
export const createVideoSchema = z.object({
  caption: z.string().trim().max(500, 'Caption must be at most 500 characters').optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});

export const updateVideoSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const commentSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(500, 'Comment must be at most 500 characters'),
});

export const listCommentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reportVideoSchema = z.object({
  reason: z.enum([
    'SPAM',
    'NUDITY_OR_SEXUAL_CONTENT',
    'VIOLENCE',
    'HARASSMENT_OR_BULLYING',
    'HATE_SPEECH',
    'MISINFORMATION',
    'OTHER',
  ]),
  description: z.string().trim().max(500).optional(),
});
