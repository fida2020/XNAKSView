/// Environment configuration for the admin app.
///
/// Only `NEXT_PUBLIC_*` variables are readable in the browser — anything
/// secret (service tokens, DB URLs) must never be prefixed that way and must
/// only be read in server components/route handlers.
function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  apiBaseUrl: requireEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:4000/api/v1'),
  appName: 'XNAKView Admin',
};
