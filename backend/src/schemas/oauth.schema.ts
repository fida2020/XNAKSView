import { z } from 'zod';

import { displayNameSchema, usernameSchema } from '@/schemas/profile.schema';
import { deviceSchema } from '@/schemas/auth.schema';

export const oauthProviderSchema = z.enum(['GOOGLE', 'FACEBOOK']);

export const oauthAuthenticateSchema = z.object({
  provider: oauthProviderSchema,
  // Google: the ID token from `google_sign_in` (audienced to
  // GOOGLE_OAUTH_SERVER_CLIENT_ID). Facebook: the access token from
  // `flutter_facebook_auth`.
  token: z.string().min(1, 'token is required'),
  device: deviceSchema.optional(),
});

export const oauthLinkSchema = z.object({
  linkingToken: z.string().min(1, 'linkingToken is required'),
  password: z.string().min(1, 'password is required'),
  device: deviceSchema.optional(),
});

const dateOfBirthSchema = z.coerce
  .date()
  .refine((date) => !Number.isNaN(date.getTime()), 'Invalid date of birth')
  .refine((date) => date <= new Date(), 'Date of birth cannot be in the future')
  .refine((date) => date.getUTCFullYear() >= 1900, 'Date of birth is not plausible');

export const oauthCompleteSignupSchema = z.object({
  socialSignupToken: z.string().min(1, 'socialSignupToken is required'),
  dateOfBirth: dateOfBirthSchema,
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
  // Defaults to the provider's own picture (see lib/oauthService.ts) when
  // omitted — the user can still override it with their own upload.
  avatarUrl: z.string().url('avatarUrl must be a valid URL').startsWith('https://', 'avatarUrl must use https').optional(),
  device: deviceSchema.optional(),
});

export type OAuthAuthenticateInput = z.infer<typeof oauthAuthenticateSchema>;
export type OAuthLinkInput = z.infer<typeof oauthLinkSchema>;
export type OAuthCompleteSignupInput = z.infer<typeof oauthCompleteSignupSchema>;
