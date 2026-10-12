import { router, type Href } from "expo-router";

/**
 * Clear the navigation history and land on `href`.
 *
 * Expo Router queues `back()` until the next render, so the stack never
 * shrinks inside a `while (router.canGoBack()) router.back()` loop — it spins
 * forever and freezes the JS thread.
 */
export function resetTo(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  setTimeout(() => router.replace(href), 100);
}
