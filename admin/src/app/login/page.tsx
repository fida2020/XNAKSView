/// Placeholder login screen. Real authentication (credentials, session
/// issuance, MFA if applicable) is built alongside backend auth in Phase 2 —
/// this exists so `middleware.ts` has a concrete public route to redirect
/// unauthenticated requests to.
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8 text-center dark:border-white/10">
        <h1 className="text-xl font-semibold">XNAKView Admin</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Sign-in is not implemented yet (Phase 2).
        </p>
      </div>
    </div>
  );
}
