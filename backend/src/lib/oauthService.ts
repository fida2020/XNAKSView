import type { AuthProvider } from '@prisma/client';
import { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { meetsMinimumAge, MINIMUM_REGISTRATION_AGE } from '@/lib/age';
import { maskIdentifier } from '@/lib/otpService';
import { facebookOAuthVerifier, googleOAuthVerifier, type OAuthIdentity } from '@/lib/oauthProviders';
import { prisma } from '@/lib/prisma';
import type { DeviceInput } from '@/lib/session';
import { issueSession } from '@/lib/session';
import { verifyPassword } from '@/lib/password';
import { AppError } from '@/utils/AppError';

const OAUTH_LINKING_TOKEN_TYPE = 'oauth_linking';
const OAUTH_SIGNUP_TOKEN_TYPE = 'oauth_signup';

function verifierFor(provider: AuthProvider) {
  return provider === 'GOOGLE' ? googleOAuthVerifier : facebookOAuthVerifier;
}

interface UserSummary {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
  ageVerified: boolean;
}

function serializeUser(user: { id: string; email: string | null; phone: string | null; status: string; ageVerified: boolean }): UserSummary {
  return { id: user.id, email: user.email, phone: user.phone, status: user.status, ageVerified: user.ageVerified };
}

export type OAuthAuthenticateResult =
  | { outcome: 'LOGIN'; user: UserSummary; accessToken: string; refreshToken: string; accessTokenExpiresIn: string; refreshTokenExpiresAt: Date }
  | { outcome: 'NEEDS_LINKING'; linkingToken: string; maskedEmail: string }
  | { outcome: 'NEW_SIGNUP'; socialSignupToken: string; email: string | null; suggestedUsername: string | null; name: string | null; pictureUrl: string | null };

/** Derives a plausible, NOT guaranteed-unique username suggestion from a provider name/email — the client still lets the user edit it, and the server still enforces real uniqueness at signup completion. */
function suggestUsername(identity: OAuthIdentity): string | null {
  const source = identity.name?.trim() || identity.email?.split('@')[0];
  if (!source) return null;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) return null;
  return /^[a-z]/.test(slug) ? slug.slice(0, 20) : `u_${slug}`.slice(0, 20);
}

/**
 * Google/Facebook "Continue with…" — verifies the real provider token
 * (lib/oauthProviders.ts), then resolves exactly one of three outcomes:
 * a linked identity logs in immediately; a verified-but-unlinked identity
 * whose email matches an existing account requires the account-linking
 * re-authentication flow (never silently linked — brief §5); a genuinely
 * new identity gets a short-lived signup token and proceeds straight to
 * profile setup, skipping OTP entirely (the provider already proved
 * ownership of the identity).
 */
export async function authenticateWithOAuth(provider: AuthProvider, token: string, device?: DeviceInput): Promise<OAuthAuthenticateResult> {
  const result = await verifierFor(provider).verify(token);
  if (!result.verified || !result.identity) {
    throw new AppError('UNAUTHORIZED', result.reason ?? `${provider === 'GOOGLE' ? 'Google' : 'Facebook'} sign-in could not be verified`);
  }
  const identity = result.identity;

  const existingIdentity = await prisma.authIdentity.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
  });

  if (existingIdentity) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existingIdentity.userId } });
    if (user.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', `Account is ${user.status.toLowerCase().replace('_', ' ')}`);
    }
    const tokens = await issueSession(user.id, device);
    return { outcome: 'LOGIN', user: serializeUser(user), ...tokens };
  }

  // Only a PROVIDER-VERIFIED email is trusted to match an existing account —
  // an unverified provider email is treated the same as no email at all.
  const trustedEmail = identity.emailVerified ? identity.email : null;
  if (trustedEmail) {
    const existingUser = await prisma.user.findUnique({ where: { email: trustedEmail } });
    if (existingUser) {
      const linkingToken = jwt.sign(
        { sub: existingUser.id, provider, providerAccountId: identity.providerAccountId, email: trustedEmail, typ: OAUTH_LINKING_TOKEN_TYPE },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' },
      );
      return { outcome: 'NEEDS_LINKING', linkingToken, maskedEmail: maskIdentifier(trustedEmail, 'EMAIL') };
    }
  }

  const socialSignupToken = jwt.sign(
    {
      provider,
      providerAccountId: identity.providerAccountId,
      email: trustedEmail,
      name: identity.name,
      pictureUrl: identity.pictureUrl,
      typ: OAUTH_SIGNUP_TOKEN_TYPE,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '30m' },
  );
  return {
    outcome: 'NEW_SIGNUP',
    socialSignupToken,
    email: trustedEmail,
    suggestedUsername: suggestUsername(identity),
    name: identity.name,
    pictureUrl: identity.pictureUrl,
  };
}

interface LinkingTokenPayload {
  sub: string;
  provider: AuthProvider;
  providerAccountId: string;
  email: string | null;
  typ: string;
}

/**
 * Completes account linking — the existing account's password is the
 * re-authentication proof that the person driving this OAuth flow actually
 * owns the account the verified email matched (never linked merely because
 * the email matched, per brief §5).
 */
export async function linkOAuthIdentity(linkingToken: string, password: string, device?: DeviceInput) {
  let payload: LinkingTokenPayload;
  try {
    payload = jwt.verify(linkingToken, env.JWT_ACCESS_SECRET) as unknown as LinkingTokenPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'This linking request has expired. Please sign in with the provider again.');
  }
  if (payload.typ !== OAUTH_LINKING_TOKEN_TYPE) {
    throw new AppError('UNAUTHORIZED', 'Invalid linking request');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'This linking request has expired. Please sign in with the provider again.');
  }
  if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('UNAUTHORIZED', 'Incorrect password');
  }
  if (user.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', `Account is ${user.status.toLowerCase().replace('_', ' ')}`);
  }

  try {
    await prisma.authIdentity.create({
      data: { userId: user.id, provider: payload.provider, providerAccountId: payload.providerAccountId, email: payload.email },
    });
  } catch (error) {
    // Already linked by a concurrent/retried request — same identity,
    // same account, safe to proceed as a normal login.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      throw error;
    }
  }

  const tokens = await issueSession(user.id, device);
  return { user: serializeUser(user), ...tokens };
}

interface SignupTokenPayload {
  provider: AuthProvider;
  providerAccountId: string;
  email: string | null;
  name: string | null;
  pictureUrl: string | null;
  typ: string;
}

export interface CompleteOAuthSignupParams {
  socialSignupToken: string;
  dateOfBirth: Date;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  device?: DeviceInput;
}

/**
 * Creates the XNAKView account for a genuinely new social identity —
 * birthday/18+ is enforced here exactly like the OTP-first flow's
 * `/auth/register` (never trusted from the provider, which brief §3
 * explicitly warns doesn't reliably supply a verified DOB). Account +
 * AuthIdentity + Profile are created together, so this single call is also
 * what completes profile setup — no separate post-signup profile step.
 */
export async function completeOAuthSignup(params: CompleteOAuthSignupParams) {
  let payload: SignupTokenPayload;
  try {
    payload = jwt.verify(params.socialSignupToken, env.JWT_ACCESS_SECRET) as unknown as SignupTokenPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Your sign-in has expired. Please continue with the provider again.');
  }
  if (payload.typ !== OAUTH_SIGNUP_TOKEN_TYPE) {
    throw new AppError('UNAUTHORIZED', 'Invalid signup request');
  }

  if (!meetsMinimumAge(params.dateOfBirth)) {
    throw new AppError('FORBIDDEN', `You must be at least ${MINIMUM_REGISTRATION_AGE} years old to register`);
  }

  const existingIdentity = await prisma.authIdentity.findUnique({
    where: { provider_providerAccountId: { provider: payload.provider, providerAccountId: payload.providerAccountId } },
  });
  if (existingIdentity) {
    throw new AppError('CONFLICT', 'This account has already been created — please log in instead');
  }
  if (payload.email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email: payload.email } });
    if (existingByEmail) {
      throw new AppError('CONFLICT', 'An account with this email already exists — please log in and link this provider from there');
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: payload.email,
          passwordHash: null,
          dateOfBirth: params.dateOfBirth,
          ageVerified: true,
          status: 'ACTIVE',
        },
      });
      await tx.authIdentity.create({
        data: { userId: user.id, provider: payload.provider, providerAccountId: payload.providerAccountId, email: payload.email },
      });
      await tx.profile.create({
        data: {
          userId: user.id,
          username: params.username,
          displayName: params.displayName ?? payload.name ?? undefined,
          avatarUrl: params.avatarUrl ?? payload.pictureUrl ?? undefined,
        },
      });
      return user;
    });

    const tokens = await issueSession(created.id, params.device);
    return { user: serializeUser(created), ...tokens };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined) ?? [];
      if (target.includes('username')) {
        throw new AppError('CONFLICT', 'Username is already taken');
      }
      throw new AppError('CONFLICT', 'This account has already been created');
    }
    throw error;
  }
}
