import { Router } from 'express';

import { authenticateWithOAuth, completeOAuthSignup, linkOAuthIdentity } from '@/lib/oauthService';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { oauthAuthenticateSchema, oauthCompleteSignupSchema, oauthLinkSchema } from '@/schemas/oauth.schema';

export const oauthRouter = Router();

const oauthLimiter = createAuthRateLimiter(15 * 60 * 1000, 20, 'oauth');

/**
 * Real Google/Facebook "Continue with…" (lib/oauthProviders.ts verifies the
 * token server-side — never a fake/client-only sign-in). Returns exactly
 * one of three outcomes; see lib/oauthService.ts's `authenticateWithOAuth`.
 */
oauthRouter.post('/auth/oauth/authenticate', oauthLimiter, validate({ body: oauthAuthenticateSchema }), async (req, res, next) => {
  try {
    const { provider, token, device } = req.body;
    const result = await authenticateWithOAuth(provider, token, device);

    if (result.outcome === 'LOGIN') {
      res.status(200).json({ user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken, accessTokenExpiresIn: result.accessTokenExpiresIn, refreshTokenExpiresAt: result.refreshTokenExpiresAt });
      return;
    }
    if (result.outcome === 'NEEDS_LINKING') {
      res.status(200).json({ needsLinking: true, linkingToken: result.linkingToken, maskedEmail: result.maskedEmail });
      return;
    }
    res.status(200).json({
      isNewSignup: true,
      socialSignupToken: result.socialSignupToken,
      email: result.email,
      suggestedUsername: result.suggestedUsername,
      name: result.name,
      pictureUrl: result.pictureUrl,
    });
  } catch (error) {
    next(error);
  }
});

/** Account linking (brief §5) — the existing account's password proves ownership before the provider identity is attached; never linked merely because the email matched. */
oauthRouter.post('/auth/oauth/link', oauthLimiter, validate({ body: oauthLinkSchema }), async (req, res, next) => {
  try {
    const { linkingToken, password, device } = req.body;
    const result = await linkOAuthIdentity(linkingToken, password, device);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/** Completes a NEW social signup — birthday/18+ enforced, Profile (username/displayName/avatar) created in the same step. */
oauthRouter.post('/auth/oauth/complete-signup', oauthLimiter, validate({ body: oauthCompleteSignupSchema }), async (req, res, next) => {
  try {
    const { socialSignupToken, dateOfBirth, username, displayName, avatarUrl, device } = req.body;
    const result = await completeOAuthSignup({ socialSignupToken, dateOfBirth, username, displayName, avatarUrl, device });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
