import { createHmac, timingSafeEqual } from 'crypto';

import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';

export interface PaymentVerificationResult {
  verified: boolean;
  /** A stable id from the provider for this exact payment — becomes `CoinPurchase.providerTransactionId`, unique, so the same real-world payment can never be verified into two different purchases. */
  providerTransactionId: string;
  reason?: string;
}

export interface PaymentProvider {
  verifyPurchase(receipt: string): Promise<PaymentVerificationResult>;
}

/**
 * Real Apple App Store server-to-server receipt verification
 * (`verifyReceipt`) — tries production first, retries against the sandbox
 * endpoint on Apple's documented 21007 "sandbox receipt used against
 * production" status, exactly as Apple's own integration guide specifies.
 * Refuses to verify anything (never fake-succeeds) when
 * `APPLE_SHARED_SECRET` isn't configured.
 */
class AppStoreProvider implements PaymentProvider {
  async verifyPurchase(receiptData: string): Promise<PaymentVerificationResult> {
    if (!env.APPLE_SHARED_SECRET) {
      return { verified: false, providerTransactionId: '', reason: 'App Store verification is not configured on this server' };
    }

    const verifyAt = async (url: string) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'receipt-data': receiptData, password: env.APPLE_SHARED_SECRET, 'exclude-old-transactions': true }),
      });
      return response.json() as Promise<{ status: number; latest_receipt_info?: { transaction_id: string }[] }>;
    };

    try {
      let result = await verifyAt(env.APPLE_VERIFY_RECEIPT_URL);
      if (result.status === 21007) {
        result = await verifyAt(env.APPLE_VERIFY_RECEIPT_SANDBOX_URL);
      }
      if (result.status !== 0) {
        return { verified: false, providerTransactionId: '', reason: `Apple rejected the receipt (status ${result.status})` };
      }
      const transactionId = result.latest_receipt_info?.[0]?.transaction_id;
      if (!transactionId) {
        return { verified: false, providerTransactionId: '', reason: 'Apple verification response had no transaction id' };
      }
      return { verified: true, providerTransactionId: transactionId };
    } catch (error) {
      logger.error({ err: error }, 'App Store receipt verification request failed');
      return { verified: false, providerTransactionId: '', reason: 'Could not reach Apple to verify this receipt' };
    }
  }
}

/**
 * Real Google Play Developer API verification
 * (`purchases.products.get`) via a service-account OAuth2 token. The
 * receipt is `${productId}:${purchaseToken}` (the two values the Play
 * Billing Library gives the client after a purchase). Refuses to verify
 * anything when service-account credentials aren't configured.
 */
class GooglePlayProvider implements PaymentProvider {
  async verifyPurchase(receipt: string): Promise<PaymentVerificationResult> {
    if (!env.GOOGLE_PLAY_PACKAGE_NAME || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY) {
      return { verified: false, providerTransactionId: '', reason: 'Google Play verification is not configured on this server' };
    }
    const [productId, purchaseToken] = receipt.split(':');
    if (!productId || !purchaseToken) {
      return { verified: false, providerTransactionId: '', reason: 'Malformed Google Play receipt (expected "productId:purchaseToken")' };
    }

    try {
      const accessToken = await this.getAccessToken();
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.GOOGLE_PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        return { verified: false, providerTransactionId: '', reason: `Google Play rejected the token (HTTP ${response.status})` };
      }
      const body = (await response.json()) as { purchaseState?: number; orderId?: string };
      // purchaseState: 0 = purchased, 1 = cancelled, 2 = pending.
      if (body.purchaseState !== 0 || !body.orderId) {
        return { verified: false, providerTransactionId: '', reason: 'Google Play purchase is not in a completed state' };
      }
      return { verified: true, providerTransactionId: body.orderId };
    } catch (error) {
      logger.error({ err: error }, 'Google Play purchase verification failed');
      return { verified: false, providerTransactionId: '', reason: 'Could not reach Google Play to verify this purchase' };
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      { algorithm: 'RS256' },
    );
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error('Google OAuth token exchange did not return an access token');
    }
    return body.access_token;
  }
}

/**
 * Web checkout — since the brief names no specific gateway to integrate,
 * this verifies a provider-agnostic HMAC-SHA256 signature over the
 * transaction rather than trusting a bare "it succeeded" flag from the
 * client. `receipt` is JSON: `{ transactionId, amountUsdCents, signature }`
 * where `signature = HMAC-SHA256(WEB_PAYMENT_WEBHOOK_SECRET, "transactionId:amountUsdCents")`.
 * A real webhook-signing gateway (Stripe, PayPal, etc.) slots in here later
 * without changing anything upstream of this class.
 */
class WebPaymentProvider implements PaymentProvider {
  async verifyPurchase(receipt: string): Promise<PaymentVerificationResult> {
    if (!env.WEB_PAYMENT_WEBHOOK_SECRET) {
      return { verified: false, providerTransactionId: '', reason: 'Web payment verification is not configured on this server' };
    }

    let parsed: { transactionId?: string; amountUsdCents?: number; signature?: string };
    try {
      parsed = JSON.parse(receipt);
    } catch {
      return { verified: false, providerTransactionId: '', reason: 'Malformed web payment receipt' };
    }
    const { transactionId, amountUsdCents, signature } = parsed;
    if (!transactionId || amountUsdCents === undefined || !signature) {
      return { verified: false, providerTransactionId: '', reason: 'Web payment receipt is missing required fields' };
    }

    const expected = createHmac('sha256', env.WEB_PAYMENT_WEBHOOK_SECRET).update(`${transactionId}:${amountUsdCents}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const signatureValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    if (!signatureValid) {
      return { verified: false, providerTransactionId: '', reason: 'Web payment signature does not match' };
    }
    return { verified: true, providerTransactionId: transactionId };
  }
}

const providers: Record<'APP_STORE' | 'GOOGLE_PLAY' | 'WEB', PaymentProvider> = {
  APP_STORE: new AppStoreProvider(),
  GOOGLE_PLAY: new GooglePlayProvider(),
  WEB: new WebPaymentProvider(),
};

export function getPaymentProvider(provider: 'APP_STORE' | 'GOOGLE_PLAY' | 'WEB'): PaymentProvider {
  return providers[provider];
}
