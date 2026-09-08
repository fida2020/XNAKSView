import { z } from 'zod';

// Lowercase to keep uniqueness checks unambiguous ("Fida" and "fida" collide).
// Exported for reuse by schemas/oauth.schema.ts (completing a social
// signup creates the Profile in the same step, same validation rules).
export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Username must start with a letter and contain only letters, digits, or underscores')
  .transform((value) => value.toLowerCase());

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name cannot be empty')
  .max(50, 'Display name must be at most 50 characters')
  .regex(/^[^\r\n\t]*$/, 'Display name cannot contain control characters');

export const upsertProfileSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
  bio: z.string().max(300, 'Bio must be at most 300 characters').optional(),
  avatarUrl: z.string().url('avatarUrl must be a valid URL').startsWith('https://', 'avatarUrl must use https').optional(),
  country: z.string().trim().max(56).optional(),
  city: z.string().trim().max(85).optional(),
});

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;
