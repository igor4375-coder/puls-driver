/**
 * `useSignIn()` and `useSignUp()` from @clerk/expo are backed by
 * `useSyncExternalStore`, so the object they return is a snapshot of the render
 * it was read in — not a live handle. Reading `status` or
 * `supportedFirstFactors` off it *after* an `await` therefore describes the
 * state before that call, which dead-ended every email and SMS code flow: the
 * post-`create()` status check never matched, so no code was ever sent, and the
 * post-verify check reported "incomplete" on codes that had actually worked.
 * OAuth kept working throughout because `useSSO` runs on the legacy mutable
 * resource instead.
 *
 * The methods on the snapshot are safe to call — they act on the underlying
 * resource. It is only *reads* of derived state that go stale, so read those
 * from the live client resource below.
 */

type ClerkLike = {
  client?: {
    signIn?: Record<string, any> | null;
    signUp?: Record<string, any> | null;
  } | null;
};

export function liveSignIn(clerk: unknown): Record<string, any> | undefined {
  return (clerk as ClerkLike | undefined)?.client?.signIn ?? undefined;
}

export function liveSignUp(clerk: unknown): Record<string, any> | undefined {
  return (clerk as ClerkLike | undefined)?.client?.signUp ?? undefined;
}

/**
 * Message steering a driver to the provider their account was actually created
 * with, for accounts that have no code-based first factor available.
 */
export function oauthOnlyMessage(factors: unknown): string | null {
  const list = Array.isArray(factors) ? factors : [];
  const factor = list.find((f: any) =>
    String(f?.strategy ?? "").startsWith("oauth_"),
  );
  if (!factor) return null;
  const provider = String((factor as any).strategy).replace("oauth_", "");
  const label =
    provider === "google" ? "Google" : provider === "apple" ? "Apple" : provider;
  return `This account uses ${label} sign-in. Go back and tap "Continue with ${label}".`;
}

/** Pulls the most useful human-readable string out of a Clerk error shape. */
export function clerkErrorMessage(err: any, fallback: string): string {
  return (
    err?.errors?.[0]?.longMessage ??
    err?.errors?.[0]?.message ??
    err?.longMessage ??
    err?.message ??
    fallback
  );
}
