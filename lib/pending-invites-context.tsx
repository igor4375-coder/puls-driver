/**
 * Pending company invites, app-wide.
 *
 * These used to be fetched inside the Profile screen, which meant they only
 * existed while that tab was mounted. Drivers never thought to look there, so
 * invites sat unanswered until someone phoned to tell them which screen to
 * open. Holding the list at the root lets a banner follow the driver around
 * until the invite is actually answered.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAction } from "convex/react";

import { api } from "@/convex/_generated/api";

export interface PendingInvite {
  inviteId: number | string;
  companyName: string;
  companyCode?: string;
  companyOrgId?: string;
  exclusive?: boolean;
  message?: string;
}

interface PendingInvitesValue {
  invites: PendingInvite[];
  /** True only for the first load, so the banner never flickers on a poll. */
  loading: boolean;
  refresh: () => Promise<void>;
}

const PendingInvitesContext = createContext<PendingInvitesValue>({
  invites: [],
  loading: false,
  refresh: async () => {},
});

const POLL_MS = 15_000;

export function PendingInvitesProvider({
  driverCode,
  children,
}: {
  driverCode?: string | null;
  children: React.ReactNode;
}) {
  const getPendingInvites = useAction(api.platform.getPendingInvites);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const hasFetched = useRef(false);

  const refresh = useCallback(async () => {
    if (!driverCode) {
      setInvites([]);
      return;
    }
    if (!hasFetched.current) setLoading(true);
    try {
      const result = await getPendingInvites({ driverCode });
      setInvites(Array.isArray(result) ? (result as PendingInvite[]) : []);
    } catch (err) {
      // A failed poll must not clear a banner the driver still needs to answer.
      console.warn("[Invites] fetch failed:", err);
    } finally {
      setLoading(false);
      hasFetched.current = true;
    }
  }, [driverCode, getPendingInvites]);

  useEffect(() => {
    hasFetched.current = false;
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <PendingInvitesContext.Provider value={{ invites, loading, refresh }}>
      {children}
    </PendingInvitesContext.Provider>
  );
}

export function usePendingInvites(): PendingInvitesValue {
  return useContext(PendingInvitesContext);
}
