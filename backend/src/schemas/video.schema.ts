import { z } from 'zod';

// multipart/form-data text fields always arrive as strings, so a plain
// z.coerce.boolean() is a trap here: Boolean("false") is `true` (any
// non-empty string is truthy), which would make the field impossible to
// ever set to false from a real multipart request. This accepts an actual
// boolean (JSON bodies) or the literal strings "true"/"false" only.
const multipartBoolean = (defaultValue: boolean) =>
  z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').default(defaultValue);

// multipart/form-data text fields always arrive as strings, so this
// validates req.body *after* multer has parsed the upload.
export const createVideoSchema = z.object({
  caption: z.string().trim().max(500, 'Caption must be at most 500 characters').optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  allowDuet: multipartBoolean(true),
  allowStitch: multipartBoolean(true),
  allowDownload: multipartBoolean(true),
  // Add Yours (brief G): the prompt text this video itself carries, if any
  // — never set on a video that is itself responding to someone else's
  // prompt (that goes through POST /videos/:id/add-yours instead).
  addYoursPrompt: z.string().trim().min(1).max(150).optional(),
  // Sounds (brief C): reuse an existing Sound's audio — must already exist
  // (see routes/v1/sounds.ts's lazy creation), never a client-asserted
  // arbitrary id for something that doesn't exist.
  soundId: z.string().uuid().optional(),
});

export const updateVideoSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
});

export const createDuetSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});

export const createStitchSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  // Milliseconds into the SOURCE video — current TikTok behavior lets the
  // creator trim/select which up-to-5-second window of the source to use
  // from anywhere in it, not just the start. `sourceStartMs` can be
  // anywhere in the source; the server still caps the span to 5s and to
  // the source's real duration (see routes/v1/videos.ts) — a client-claimed
  // range is never trusted beyond that clamp.
  sourceStartMs: z.coerce.number().int().min(0).default(0),
  sourceEndMs: z.coerce.number().int().min(0),
});

export const commentReportSchema = z.object({
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
  // One level of replies only, matching current TikTok behavior — a reply
  // to a reply is rejected server-side (see routes/v1/videos.ts), not just
  // by leaving this field out.
  parentId: z.string().uuid().optional(),
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
