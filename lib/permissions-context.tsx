import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

interface DriverPermissions {
  canViewRates: boolean;
  exclusive: boolean;
}

interface PermissionsContextValue extends DriverPermissions {
  loading: boolean;
  /** Re-fetch from driversApi.getDriverPermissions (source of truth — do not cache invite data). */
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  canViewRates: true,
  exclusive: false,
  loading: true,
  refresh: async () => {},
});

export function usePermissions() {
  return useContext(PermissionsContext);
}

/**
 * Polls company-platform getDriverPermissions.
 *
 * Carriers can flip exclusive / canViewRates without a push, so we refresh:
 *   - whenever driverCode changes
 *   - on every AppState → active (foreground)
 * Callers (My Companies, Profile) should also call refresh() on screen focus.
 */
export function PermissionsProvider({
  driverCode,
  children,
}: {
  driverCode?: string | null;
  children: React.ReactNode;
}) {
  const [permissions, setPermissions] = useState<DriverPermissions>({
    canViewRates: true,
    exclusive: false,
  });
  const [loading, setLoading] = useState(true);
  const fetchPermissions = useAction(api.platform.getDriverPermissions);

  const refresh = useCallback(async () => {
    if (!driverCode || driverCode.length < 7) {
      setPermissions({ canViewRates: true, exclusive: false });
      setLoading(false);
      return;
    }
    try {
      const result = await fetchPermissions({ driverCode });
      setPermissions({
        canViewRates: result.canViewRates,
        exclusive: result.exclusive,
      });
    } catch {
      // Keep last-known values on transient failures — don't flip rates/exclusive
      // to defaults mid-session just because the network blipped.
    } finally {
      setLoading(false);
    }
  }, [driverCode, fetchPermissions]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active") void refresh();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refresh]);

  return (
    <PermissionsContext.Provider value={{ ...permissions, loading, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}
