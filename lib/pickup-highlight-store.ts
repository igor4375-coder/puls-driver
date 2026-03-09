/**
 * tab-highlight-store.ts  (exported as pickupHighlightStore for backwards compat)
 *
 * A tiny in-memory signal that any screen can set after a load status change.
 * The loads list screen reads it on useFocusEffect and:
 *   1. Switches to the destination tab
 *   2. Plays a pulse animation on that tab's pill
 *   3. Shows a toast with the provided message
 */

export type TabFilter = "new" | "picked_up" | "delivered" | "archived";

interface HighlightSignal {
  tab: TabFilter;
  message: string;
}

let _pending: HighlightSignal | null = null;

export const pickupHighlightStore = {
  /**
   * Signal a tab transition. Call this immediately after changing a load's status.
   * @param tab     The destination tab the load moved to
   * @param message The toast message to show the driver
   */
  signal(tab: TabFilter, message: string) {
    _pending = { tab, message };
  },

  /**
   * Consume the pending signal. Returns the signal once, then resets to null.
   * Call from the loads screen's useFocusEffect.
   */
  consume(): HighlightSignal | null {
    if (_pending) {
      const result = _pending;
      _pending = null;
      return result;
    }
    return null;
  },
};
