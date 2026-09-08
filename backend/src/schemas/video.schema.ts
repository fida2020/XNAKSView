import { z } from 'zod';

// multipart/form-data text fields always arrive as strings, so a plain
// z.coerce.boolean() is a trap here: Boolean("false") is `true` (any
// non-empty string is truthy), which would make the field impossible to
// ever set to false from a real multipart request. This accepts an actual
// boolean (JSON bodies) or the literal strings "true"/"false" only.
const multipartBoolean = (defaultValue: boolean) =>
  z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').default(defaultValue);

// Video editor rebuild — the real trim/speed/filter/text/rotate/cover/
// volume spec applied at render time (see lib/ffmpeg.ts's renderEditedVideo).
// Arrives as a JSON string inside multipart form data (there is no native
// nested-object multipart encoding), so this is validated separately from
// createVideoSchema's own multer-parsed string fields — see
// parseVideoEditSpec below.
const textOverlaySchema = z.object({
  text: z.string().trim().min(1).max(120),
  xPct: z.number().min(0).max(1),
  yPct: z.number().min(0).max(1),
  fontSizePx: z.number().int().min(12).max(160).default(48),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex value like #FFFFFF')
    .default('#FFFFFF'),
});

export const videoEditSpecSchema = z
  .object({
    trimStartMs: z.number().int().min(0).optional(),
    trimEndMs: z.number().int().min(1).optional(),
    // TikTok-style range; 0.3x-3x covers the common presets (0.3/0.5/1/2/3).
    speed: z.number().min(0.3).max(3).default(1),
    filter: z.enum(['none', 'mono', 'warm', 'cool', 'vivid', 'fade']).default('none'),
    rotateDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    // Real center-crop to a target aspect ratio (see lib/ffmpeg.ts's
    // buildCropFilter) — 'original' applies no crop.
    cropAspect: z.enum(['original', '1:1', '9:16', '16:9']).default('original'),
    textOverlays: z.array(textOverlaySchema).max(5).default([]),
    originalVolume: z.number().min(0).max(1).default(1),
    soundVolume: z.number().min(0).max(1).default(1),
    voiceoverVolume: z.number().min(0).max(1).default(1),
    coverAtMs: z.number().int().min(0).optional(),
  })
  .refine((spec) => spec.trimStartMs === undefined || spec.trimEndMs === undefined || spec.trimEndMs > spec.trimStartMs, {
    message: 'trimEndMs must be greater than trimStartMs',
    path: ['trimEndMs'],
  });

export type VideoEditSpecInput = z.infer<typeof videoEditSpecSchema>;

/** Parses+validates the `edit` multipart field (a JSON string, or absent for an unedited post) — throws a plain Error with a real, specific message on either malformed JSON or a spec that fails validation, never silently falls back to "no edit". */
export function parseVideoEditSpec(raw: string | undefined): VideoEditSpecInput | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The "edit" field is not valid JSON');
  }
  const result = videoEditSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid edit spec: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.data;
}

// multipart/form-data text fields always arrive as strings, so this
// validates req.body *after* multer has parsed the upload.
export const createVideoSchema = z.object({
  caption: z.string().trim().max(500, 'Caption must be at most 500 characters').optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  allowDuet: multipartBoolean(true),
  allowStitch: multipartBoolean(true),
  allowDownload: multipartBoolean(true),
  allowComments: multipartBoolean(true),
  // Add Yours (brief G): the prompt text this video itself carries, if any
  // — never set on a video that is itself responding to someone else's
  // prompt (that goes through POST /videos/:id/add-yours instead).
  addYoursPrompt: z.string().trim().min(1).max(150).optional(),
  // Sounds (brief C): reuse an existing Sound's audio — must already exist
  // (see routes/v1/sounds.ts's lazy creation), never a client-asserted
  // arbitrary id for something that doesn't exist.
  soundId: z.string().uuid().optional(),
  // Real licensed music catalog (Epidemic Sound Partner Content API) —
  // mutually exclusive with soundId (see the refine below). Title/artist
  // are client-supplied from the same browse/search response the user
  // picked the track from, so the real Epidemic API isn't re-queried just
  // to label a "Recent" row (see lib/epidemicSound.ts).
  epidemicTrackId: z.string().uuid().optional(),
  epidemicTrackTitle: z.string().trim().max(200).optional(),
  epidemicTrackArtist: z.string().trim().max(200).optional(),
  // Video editor rebuild — see videoEditSpecSchema/parseVideoEditSpec above.
  edit: z.string().optional(),
}).refine((body) => !(body.soundId && body.epidemicTrackId), {
  message: 'A video can use a reused Sound or a licensed Epidemic Sound track, not both',
  path: ['epidemicTrackId'],
});

export const updateVideoSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowGifts: z.boolean().optional(),
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
  // TikTok-style For You (default, unscoped) vs Following tab — reuses the
  // existing Follow table, never a separate feed-ranking system. `friends`
  // (the Friends tab) is XNAKView's own honest definition — no separate
  // "friend request"/mutual-connection system exists, so "friend" means a
  // real, verifiable mutual follow (both directions), computed from the
  // exact same Follow rows, never a fabricated relationship.
  scope: z.enum(['forYou', 'following', 'friends']).default('forYou'),
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
