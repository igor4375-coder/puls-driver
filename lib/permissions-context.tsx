import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

interface DriverPermissions {
  canViewRates: boolean;
  exclusive: boolean;
}

interface PermissionsContextValue extends DriverPermissions {
  loading: boolean;
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
      setPermissions({ canViewRates: true, exclusive: false });
    } finally {
      setLoading(false);
    }
  }, [driverCode, fetchPermissions]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return (
    <PermissionsContext.Provider value={{ ...permissions, loading, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}
