// ─── Types ────────────────────────────────────────────────────────────────────

export type LoadStatus = "new" | "picked_up" | "delivered" | "archived";

export type DamageType = "scratch" | "dent" | "chip" | "crack" | "missing" | "broken" | "multiple_scratches" | "other";
export type DamageSeverity = "minor" | "moderate" | "severe";
export type DamageZone =
  // Bumpers
  | "front" | "rear"
  | "fl_bumper"          // Front-Left Bumper (top-right corner, top-down view)
  | "rl_bumper"          // Rear-Left Bumper (top-left corner, top-down view)
  | "rf_bumper"          // Right-Front Bumper (far right, side view)
  | "rr_bumper"          // Rear-Right Bumper (far left, side view)
  // Hood / Trunk / Roof
  | "hood" | "trunk" | "roof"
  // Glass
  | "windshield" | "rear_windshield"
  // Fenders
  | "fl_fender"          // Front-Left Fender
  | "fr_fender"          // Front-Right Fender
  // Doors (top-down view uses Left-side; side view uses Right-side)
  | "fl_door"            // Front-Left Door
  | "rl_door"            // Rear-Left Door
  | "fr_door"            // Front-Right Door
  | "rr_door"            // Rear-Right Door
  // Side panels (quarter panels)
  | "rl_panel"           // Rear-Left Panel
  | "rr_panel"           // Rear-Right Panel
  // Legacy generic sides (kept for backward compat)
  | "driver_side" | "passenger_side"
  // Wheels
  | "driver_front_wheel" | "driver_rear_wheel"
  | "passenger_front_wheel" | "passenger_rear_wheel";

export interface Damage {
  id: string;
  zone: DamageZone;
  type: DamageType;
  severity: DamageSeverity;
  description: string;
  photos: string[]; // local URIs
  /** Free-form position on the diagram (0-100 percent of diagram width/height) */
  xPct?: number;
  yPct?: number;
  /** Which diagram view the marker was placed on */
  diagramView?: "top" | "side_driver" | "front" | "rear";
}

export interface AdditionalInspection {
  odometer: string;
  notes: string;
  // Additional Inspection (YES/NO)
  drivable: boolean | null;
  windscreen: boolean | null;
  glassesIntact: boolean | null;
  titlePresent: boolean | null;
  billOfSale: boolean | null;
  // Loose Items (count or YES/NO)
  keys: number | null;
  remotes: number | null;
  headrests: number | null;
  cargoCover: boolean | null;
  spareTire: boolean | null;
  radio: boolean | null;
  manuals: boolean | null;
  navigationDisk: boolean | null;
  pluginChargerCable: boolean | null;
  headphones: boolean | null;
}

export interface VehicleInspection {
  vehicleId: string;
  damages: Damage[];
  noDamage?: boolean; // true when driver explicitly confirmed vehicle is clean
  photos: string[]; // local URIs
  notes: string;
  signatureUri?: string;
  completedAt?: string;
  additionalInspection?: AdditionalInspection;
  /** GPS coordinates where the inspection was completed */
  locationLat?: number;
  locationLng?: number;
  /** Reverse-geocoded location string (e.g., "Reinfeld, MB") */
  locationLabel?: string;
}

export interface Vehicle {
  id: string;
  year: string;
  make: string;
  model: string;
  color: string;
  vin: string;
  bodyType?: string;
  lotNumber?: string;
  /** Explicit pickup status - 'pending' means not yet confirmed even if inspection exists */
  pickupStatus?: "pending" | "confirmed";
  pickupInspection?: VehicleInspection;
  deliveryInspection?: VehicleInspection;
  /** Vehicle condition fields from gate pass / platform — null/undefined means not set by dispatcher */
  hasKeys?: boolean | null;
  starts?: boolean | null;
  drives?: boolean | null;
}

export interface ContactInfo {
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}


export interface Load {
  id: string;
  loadNumber: string;
  status: LoadStatus;
  vehicles: Vehicle[];
  pickup: {
    contact: ContactInfo;
    date: string;
    lat: number;
    lng: number;
  };
  delivery: {
    contact: ContactInfo;
    date: string;
    lat: number;
    lng: number;
  };
  driverPay: number;
  paymentType: "cod" | "ach" | "check" | "factoring";
  notes: string;
  assignedAt: string;
  /**
   * The legId from the company platform, set fresh on every platform fetch.
   * Only present on platform loads (id starts with "platform-").
   * Use this field instead of parsing load.id to avoid stale legId bugs.
   */
  platformTripId?: number | string;
  /** URL to the gate pass file attached by the dispatcher on the platform, if any */
  gatePassUrl?: string | null;
  /** ISO 8601 date string for gate pass expiry, set by the dispatcher */
  gatePassExpiresAt?: string | null;
  /** ISO 8601 date string for storage expiry — when the vehicle must leave the lot */
  storageExpiryDate?: string | null;
  /** ISO 8601 timestamp of when the driver marked this load as delivered.
   * Used for 30-day auto-archive: loads delivered more than 30 days ago move to "archived".
   */
  deliveredAt?: string | null;
  /** Company org ID from the platform — needed for getLocations filter */
  orgId?: string;
  /** True if this leg's dropoff IS the order's final destination */
  isFinalLeg?: boolean;
  /** The order's ultimate destination (may differ from this leg's delivery location) */
  finalDestination?: {
    id: string;
    name: string;
    address: string;
    city: string;
    province: string;
  };
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  truckNumber: string;
  trailerNumber: string;
  avatarInitials: string;
  /** Permanent D-XXXXX driver identity code. One ID per phone number. */
  driverCode?: string;
  /**
   * Platform-assigned driver ID returned by the company platform's registerDriver API.
   * This is the ID dispatchers search for when inviting a driver.
   * May differ from driverCode if the platform assigns its own IDs.
   */
  platformDriverCode?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

export const MOCK_DRIVER: Driver = {
  id: "d1",
  name: "Demo Driver",
  email: "demo@autohaul.app",
  phone: "(555) 000-0001",
  company: "AutoHaul Demo",
  truckNumber: "TRK-001",
  trailerNumber: "TRL-001",
  avatarInitials: "DD",
  /** Real D-XXXXX code backed by a database record — use this on the company platform to test load assignments */
  driverCode: "D-00001",
};

export const MOCK_LOADS: Load[] = [
  {
    id: "L001",
    loadNumber: "FLT-2024-001",
    status: "new",
    vehicles: [
      {
        id: "v1",
        year: "2022",
        make: "Toyota",
        model: "Camry",
        color: "White",
        vin: "4T1BF1FK5CU123456",
      },
      {
        id: "v2",
        year: "2021",
        make: "Honda",
        model: "Accord",
        color: "Silver",
        vin: "1HGCV1F38MA012345",
      },
    ],
    pickup: {
      contact: {
        name: "John Smith",
        company: "ABC Dealership",
        phone: "(816) 555-0100",
        email: "jsmith@abcdealer.com",
        address: "1234 Main St",
        city: "Kansas City",
        state: "MO",
        zip: "64108",
      },
      date: "2026-02-22",
      lat: 39.0997,
      lng: -94.5786,
    },
    delivery: {
      contact: {
        name: "Sarah Johnson",
        company: "Beverly Hills Auto",
        phone: "(310) 555-0200",
        email: "sjohnson@bhautosales.com",
        address: "9876 Rodeo Dr",
        city: "Beverly Hills",
        state: "CA",
        zip: "90210",
      },
      date: "2026-02-26",
      lat: 34.0736,
      lng: -118.4004,
    },
    driverPay: 1850,
    paymentType: "cod",
    notes: "Handle with care. White Camry has factory tint.",
    assignedAt: "2026-02-20T08:00:00Z",
  },
  {
    id: "L002",
    loadNumber: "FLT-2024-002",
    status: "new",
    vehicles: [
      {
        id: "v3",
        year: "2023",
        make: "Ford",
        model: "F-150",
        color: "Black",
        vin: "1FTEW1EP4NFA12345",
      },
    ],
    pickup: {
      contact: {
        name: "Mike Davis",
        company: "Dallas Auto Auction",
        phone: "(214) 555-0300",
        email: "mdavis@dallasauction.com",
        address: "500 Commerce St",
        city: "Dallas",
        state: "TX",
        zip: "75201",
      },
      date: "2026-02-23",
      lat: 32.7767,
      lng: -96.797,
    },
    delivery: {
      contact: {
        name: "Tom Wilson",
        company: "Wilson Motors",
        phone: "(305) 555-0400",
        email: "twilson@wilsonmotors.com",
        address: "200 Biscayne Blvd",
        city: "Miami",
        state: "FL",
        zip: "33132",
      },
      date: "2026-02-27",
      lat: 25.7617,
      lng: -80.1918,
    },
    driverPay: 1200,
    paymentType: "ach",
    notes: "",
    assignedAt: "2026-02-20T10:30:00Z",
  },
  {
    id: "L003",
    loadNumber: "FLT-2024-003",
    status: "picked_up",
    vehicles: [
      {
        id: "v4",
        year: "2020",
        make: "BMW",
        model: "3 Series",
        color: "Blue",
        vin: "WBA5R1C50LFH12345",
        pickupInspection: {
          vehicleId: "v4",
          damages: [
            {
              id: "dmg1",
              zone: "driver_side",
              type: "scratch",
              severity: "minor",
              description: "Small scratch on driver door",
              photos: [],
            },
          ],
          photos: [],
          notes: "Pre-existing scratch documented at pickup",
          completedAt: "2026-02-19T14:00:00Z",
        },
      },
    ],
    pickup: {
      contact: {
        name: "Lisa Park",
        company: "Chicago BMW",
        phone: "(312) 555-0500",
        email: "lpark@chicagobmw.com",
        address: "100 N Michigan Ave",
        city: "Chicago",
        state: "IL",
        zip: "60601",
      },
      date: "2026-02-19",
      lat: 41.8781,
      lng: -87.6298,
    },
    delivery: {
      contact: {
        name: "Robert Chen",
        company: "Seattle Imports",
        phone: "(206) 555-0600",
        email: "rchen@seattleimports.com",
        address: "1000 Pike St",
        city: "Seattle",
        state: "WA",
        zip: "98101",
      },
      date: "2026-02-24",
      lat: 47.6062,
      lng: -122.3321,
    },
    driverPay: 2100,
    paymentType: "factoring",
    notes: "BMW is a luxury vehicle — extra care required.",
    assignedAt: "2026-02-18T09:00:00Z",
  },
  {
    id: "L004",
    loadNumber: "FLT-2024-004",
    status: "delivered",
    vehicles: [
      {
        id: "v5",
        year: "2019",
        make: "Chevrolet",
        model: "Silverado",
        color: "Red",
        vin: "3GCUYDED0KG123456",
      },
    ],
    pickup: {
      contact: {
        name: "Amy Turner",
        company: "Phoenix Auto",
        phone: "(602) 555-0700",
        email: "aturner@phoenixauto.com",
        address: "2000 E Camelback Rd",
        city: "Phoenix",
        state: "AZ",
        zip: "85016",
      },
      date: "2026-02-15",
      lat: 33.4484,
      lng: -112.074,
    },
    delivery: {
      contact: {
        name: "David Lee",
        company: "Denver Trucks",
        phone: "(303) 555-0800",
        email: "dlee@denvertrucks.com",
        address: "1600 Glenarm Pl",
        city: "Denver",
        state: "CO",
        zip: "80202",
      },
      date: "2026-02-17",
      lat: 39.7392,
      lng: -104.9903,
    },
    driverPay: 950,
    paymentType: "check",
    notes: "",
    assignedAt: "2026-02-14T11:00:00Z",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getStatusLabel(status: LoadStatus): string {
  switch (status) {
    case "new": return "Pending Pickup";
    case "picked_up": return "Picked Up";
    case "delivered": return "Delivered";
    case "archived": return "Archived";
  }
}

export function getPaymentLabel(type: Load["paymentType"]): string {
  switch (type) {
    case "cod": return "Cash on Delivery";
    case "ach": return "ACH Transfer";
    case "check": return "Check";
    case "factoring": return "Factoring";
  }
}

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Not set";
  // Guard against Unix epoch zero (Jan 1, 1970 or Dec 31, 1969) which means "no date"
  if (date.getFullYear() < 1971) return "Not set";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
