import { OAuth2Client } from 'google-auth-library';

import { env, isTest } from '@/config/env';
import { logger } from '@/lib/logger';

export interface OAuthIdentity {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

export interface OAuthVerificationResult {
  verified: boolean;
  identity?: OAuthIdentity;
  reason?: string;
}

export interface OAuthVerifier {
  verify(token: string): Promise<OAuthVerificationResult>;
}

/**
 * Real Google ID token verification via `google-auth-library` (the
 * official client — hand-rolling JWKS/JWT signature verification is exactly
 * the kind of security-critical code that belongs in a vetted library, not
 * reimplemented here). Honestly refuses (never fakes success) when
 * `GOOGLE_OAUTH_SERVER_CLIENT_ID` isn't configured. The mobile client must
 * request an ID token audienced to this SAME server client id
 * (`google_sign_in`'s `serverClientId`) — verifying against the wrong
 * audience is exactly how a forged-token attack would work, so this is
 * checked, never skipped.
 */
class GoogleOAuthVerifier implements OAuthVerifier {
  private client: OAuth2Client | null = null;

  private getClient(): OAuth2Client | null {
    if (!env.GOOGLE_OAUTH_SERVER_CLIENT_ID) return null;
    if (!this.client) {
      this.client = new OAuth2Client(env.GOOGLE_OAUTH_SERVER_CLIENT_ID);
    }
    return this.client;
  }

  async verify(idToken: string): Promise<OAuthVerificationResult> {
    const client = this.getClient();
    if (!client) {
      return { verified: false, reason: 'Google Sign-In is not configured on this server (set GOOGLE_OAUTH_SERVER_CLIENT_ID)' };
    }

    try {
      const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_OAUTH_SERVER_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        return { verified: false, reason: 'Google returned no usable identity for this token' };
      }
      return {
        verified: true,
        identity: {
          providerAccountId: payload.sub,
          email: payload.email ?? null,
          emailVerified: payload.email_verified ?? false,
          name: payload.name ?? null,
          pictureUrl: payload.picture ?? null,
        },
      };
    } catch (error) {
      logger.warn({ err: error }, 'Google ID token verification failed');
      return { verified: false, reason: 'Google rejected this sign-in token' };
    }
  }
}

/**
 * Real Facebook Login verification via the Graph API — `debug_token`
 * confirms the access token is genuinely valid AND was issued for OUR app
 * (never trusts the token's mere presence), then `/me` fetches the actual
 * identity. Honestly refuses when `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`
 * aren't both configured.
 */
class FacebookOAuthVerifier implements OAuthVerifier {
  async verify(accessToken: string): Promise<OAuthVerificationResult> {
    if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
      return { verified: false, reason: 'Facebook Login is not configured on this server (set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET)' };
    }

    try {
      const appAccessToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;
      const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
      const debugResponse = await fetch(debugUrl);
      const debugJson = (await debugResponse.json()) as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };

      if (!debugResponse.ok || !debugJson.data?.is_valid || debugJson.data.app_id !== env.FACEBOOK_APP_ID) {
        return { verified: false, reason: 'Facebook rejected this sign-in token' };
      }

      const meUrl = `https://graph.facebook.com/me?fields=id,email,name,picture&access_token=${encodeURIComponent(accessToken)}`;
      const meResponse = await fetch(meUrl);
      const meJson = (await meResponse.json()) as { id?: string; email?: string; name?: string; picture?: { data?: { url?: string } } };

      if (!meResponse.ok || !meJson.id) {
        return { verified: false, reason: 'Could not read the Facebook profile for this token' };
      }

      return {
        verified: true,
        identity: {
          providerAccountId: meJson.id,
          // Facebook only returns `email` when the user granted the email
          // permission AND has a verified email on file — never assumed.
          email: meJson.email ?? null,
          emailVerified: Boolean(meJson.email),
          name: meJson.name ?? null,
          pictureUrl: meJson.picture?.data?.url ?? null,
        },
      };
    } catch (error) {
      logger.warn({ err: error }, 'Facebook token verification failed');
      return { verified: false, reason: 'Could not reach Facebook to verify this sign-in' };
    }
  }
}

// Test-only capture, exactly mirroring `otpProviders.ts`'s
// TestCapture providers — real end-to-end account-creation/linking/login
// logic is fully exercised in tests, only the actual network call to
// Google/Facebook is swapped for a deterministic in-memory identity.
// Never reachable outside `NODE_ENV=test`.
const testIdentities = new Map<string, OAuthIdentity>();

export function registerTestOAuthIdentity(token: string, identity: OAuthIdentity): void {
  testIdentities.set(token, identity);
}

class TestCaptureVerifier implements OAuthVerifier {
  async verify(token: string): Promise<OAuthVerificationResult> {
    const identity = testIdentities.get(token);
    if (!identity) {
      return { verified: false, reason: 'No test identity registered for this token' };
    }
    return { verified: true, identity };
  }
}

export const googleOAuthVerifier: OAuthVerifier = isTest ? new TestCaptureVerifier() : new GoogleOAuthVerifier();
export const facebookOAuthVerifier: OAuthVerifier = isTest ? new TestCaptureVerifier() : new FacebookOAuthVerifier();
