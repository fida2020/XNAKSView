import { DevicePlatform } from '@prisma/client';
import { z } from 'zod';

// At least 10 chars, one lowercase, one uppercase, one digit, one symbol.
// Deliberately not capped at some low max — length is the strongest single
// factor, so we only bound it to stop pathological input (bcrypt also caps
// effective input at 72 bytes, so anything past that adds no strength).
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

// E.164: leading +, no leading zero, 8-15 digits total.
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +14155552671');

const emailSchema = z
  .string()
  .email('Invalid email address')
  .transform((value) => value.toLowerCase().trim());

const dateOfBirthSchema = z.coerce
  .date()
  .refine((date) => !Number.isNaN(date.getTime()), 'Invalid date of birth')
  .refine((date) => date <= new Date(), 'Date of birth cannot be in the future')
  .refine((date) => date.getUTCFullYear() >= 1900, 'Date of birth is not plausible');

export const deviceSchema = z.object({
  deviceIdentifier: z.string().min(1).max(128),
  platform: z.nativeEnum(DevicePlatform),
});

export const registerSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    dateOfBirth: dateOfBirthSchema,
    device: deviceSchema.optional(),
    // Proof of OTP-verified ownership of the email/phone being registered
    // (see lib/otpService.ts) — OTP verification happens FIRST; this token
    // is what lets registration proceed without asking for the code again.
    verificationToken: z.string().min(1, 'verificationToken is required'),
  })
  .refine((data) => Boolean(data.email) !== Boolean(data.phone), {
    message: 'Provide exactly one of email or phone',
    path: ['email'],
  });

export const otpRequestSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    purpose: z.enum(['REGISTER', 'LOGIN']),
  })
  .refine((data) => Boolean(data.email) !== Boolean(data.phone), {
    message: 'Provide exactly one of email or phone',
    path: ['email'],
  });

export const otpVerifySchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    purpose: z.enum(['REGISTER', 'LOGIN']),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    device: deviceSchema.optional(),
  })
  .refine((data) => Boolean(data.email) !== Boolean(data.phone), {
    message: 'Provide exactly one of email or phone',
    path: ['email'],
  });

const usernameSchema = z.string().trim().toLowerCase();

export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    username: usernameSchema.optional(),
    password: z.string().min(1, 'Password is required'),
    device: deviceSchema.optional(),
  })
  .refine((data) => [data.email, data.phone, data.username].filter(Boolean).length === 1, {
    message: 'Provide exactly one of email, phone, or username',
    path: ['email'],
  });

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
