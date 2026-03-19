/**
 * Settings Context
 *
 * Stores app-level display preferences locally with AsyncStorage.
 * No server sync needed — these are purely per-device UI choices.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "autohaul_app_settings_v2";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RouteDisplayMode = "city" | "facility";
export type MapsApp = "apple" | "google";
export interface StrokePath { d: string }

export interface AppSettings {
  /** Controls what is shown on load card pickup/dropoff points */
  routeDisplayMode: RouteDisplayMode;
  /**
   * Preferred maps app for opening addresses.
   * null = not yet chosen (will prompt on first tap).
   */
  mapsApp: MapsApp | null;
  /**
   * Saved driver signature paths (SVG path data).
   * Set once in Settings; auto-applied when customer is not available.
   */
  driverSignaturePaths: StrokePath[];
  /** Share location with dispatch every ~15 min (default: true) */
  locationTrackingEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  routeDisplayMode: "city",
  mapsApp: null,
  driverSignaturePaths: [],
  locationTrackingEnabled: true,
};

// ─── Context ──────────────────────────────────────────────────────────────────

interface SettingsContextValue {
  settings: AppSettings;
  setRouteDisplayMode: (mode: RouteDisplayMode) => void;
  setMapsApp: (app: MapsApp) => void;
  setDriverSignaturePaths: (paths: StrokePath[]) => void;
  setLocationTrackingEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  setRouteDisplayMode: () => {},
  setMapsApp: () => {},
  setDriverSignaturePaths: () => {},
  setLocationTrackingEnabled: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Load persisted settings on mount
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((val) => {
      if (val) {
        try {
          const parsed = JSON.parse(val) as Partial<AppSettings>;
          setSettings((prev) => ({ ...prev, ...parsed }));
        } catch {
          // ignore corrupt data
        }
      }
    });
  }, []);

  // Persist whenever settings change
  function persist(next: AppSettings) {
    setSettings(next);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  }

  const setRouteDisplayMode = (mode: RouteDisplayMode) => {
    persist({ ...settings, routeDisplayMode: mode });
  };

  const setMapsApp = (app: MapsApp) => {
    persist({ ...settings, mapsApp: app });
  };

  const setDriverSignaturePaths = (paths: StrokePath[]) => {
    persist({ ...settings, driverSignaturePaths: paths });
  };

  const setLocationTrackingEnabled = (enabled: boolean) => {
    persist({ ...settings, locationTrackingEnabled: enabled });
  };

  return (
    <SettingsContext.Provider value={{ settings, setRouteDisplayMode, setMapsApp, setDriverSignaturePaths, setLocationTrackingEnabled }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSettings() {
  return useContext(SettingsContext);
}
