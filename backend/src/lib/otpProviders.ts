import nodemailer from 'nodemailer';

import { env, isTest } from '@/config/env';
import { logger } from '@/lib/logger';

export interface OtpDeliveryResult {
  sent: boolean;
  reason?: string;
  providerMessageId?: string;
}

export interface SmsProvider {
  sendSms(toE164: string, body: string): Promise<OtpDeliveryResult>;
}

export interface EmailProvider {
  sendEmail(to: string, subject: string, body: string): Promise<OtpDeliveryResult>;
}

/**
 * Real Twilio SMS delivery via a plain `fetch` call to Twilio's REST API
 * (Basic-auth with the Account SID/Auth Token) — no SDK dependency, same
 * "call the real HTTP API directly" style as `paymentProviders.ts`'s Apple/
 * Google providers. Honestly refuses (never fakes success) when
 * `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` aren't
 * configured — the exact "controlled dev error instead of a pretended send"
 * this OTP flow requires.
 */
class TwilioSmsProvider implements SmsProvider {
  async sendSms(to: string, body: string): Promise<OtpDeliveryResult> {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      return { sent: false, reason: 'SMS verification codes are not configured on this server (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)' };
    }

    try {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body }),
      });
      const json = (await response.json()) as { sid?: string; message?: string };
      if (!response.ok || !json.sid) {
        logger.error({ status: response.status, twilioError: json.message }, 'Twilio SMS send failed');
        return { sent: false, reason: 'The SMS provider rejected this message' };
      }
      return { sent: true, providerMessageId: json.sid };
    } catch (error) {
      logger.error({ err: error }, 'Twilio SMS request failed');
      return { sent: false, reason: 'Could not reach the SMS provider' };
    }
  }
}

/**
 * Real email delivery via any standard SMTP account (nodemailer). Honestly
 * refuses when `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/
 * `SMTP_FROM_EMAIL` aren't all configured, matching the same rule as the
 * SMS provider above.
 */
class SmtpEmailProvider implements EmailProvider {
  private transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

  private getTransporter(): ReturnType<typeof nodemailer.createTransport> | null {
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) {
      return null;
    }
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      });
    }
    return this.transporter;
  }

  async sendEmail(to: string, subject: string, body: string): Promise<OtpDeliveryResult> {
    const transporter = this.getTransporter();
    if (!transporter) {
      return { sent: false, reason: 'Email verification codes are not configured on this server (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL)' };
    }

    try {
      const info = await transporter.sendMail({ from: env.SMTP_FROM_EMAIL, to, subject, text: body });
      return { sent: true, providerMessageId: info.messageId };
    } catch (error) {
      logger.error({ err: error }, 'SMTP email send failed');
      return { sent: false, reason: 'Could not send the verification email' };
    }
  }
}

// Test-only capture — real generation/hashing/storage/expiry/attempt-limit
// logic in `otpService.ts` is EXACTLY the same in tests as in production;
// only this last-mile "transport" is swapped, the same "genuinely real,
// fully controllable implementation" approach as `paymentProviders.ts`'s
// WebPaymentProvider (verified with real HMAC signatures in tests instead
// of calling Apple/Google's real servers). Never reachable outside
// `NODE_ENV=test` — no fake OTP path exists in development or production.
const testCapturedMessages = new Map<string, string>();

export function getTestCapturedOtpMessage(identifier: string): string | undefined {
  return testCapturedMessages.get(identifier);
}

class TestCaptureSmsProvider implements SmsProvider {
  async sendSms(to: string, body: string): Promise<OtpDeliveryResult> {
    testCapturedMessages.set(to, body);
    return { sent: true, providerMessageId: 'test-capture' };
  }
}

class TestCaptureEmailProvider implements EmailProvider {
  async sendEmail(to: string, _subject: string, body: string): Promise<OtpDeliveryResult> {
    testCapturedMessages.set(to, body);
    return { sent: true, providerMessageId: 'test-capture' };
  }
}

export const smsProvider: SmsProvider = isTest ? new TestCaptureSmsProvider() : new TwilioSmsProvider();
export const emailProvider: EmailProvider = isTest ? new TestCaptureEmailProvider() : new SmtpEmailProvider();
