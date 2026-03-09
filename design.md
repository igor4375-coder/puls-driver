# AutoHaul Driver App — Design Document

## Brand & Color Palette

The app targets professional truck drivers in the auto transport industry. The brand should feel trustworthy, bold, and industrial — not playful. We use a dark navy primary with high-contrast orange accents to evoke the feel of a professional logistics tool.

| Token | Light | Dark | Usage |
|---|---|---|---|
| primary | #1A3C5E (navy blue) | #2563EB (bright blue) | Buttons, active tabs, CTAs |
| background | #F8F9FA | #0F1923 | Screen backgrounds |
| surface | #FFFFFF | #1A2535 | Cards, modals |
| foreground | #0F1923 | #F1F5F9 | Primary text |
| muted | #64748B | #94A3B8 | Secondary text, labels |
| border | #E2E8F0 | #2D3F55 | Dividers, card borders |
| success | #16A34A | #22C55E | Picked up, delivered badges |
| warning | #D97706 | #F59E0B | Pending, new load badges |
| error | #DC2626 | #EF4444 | Damage, alerts |
| accent | #F97316 | #FB923C | Orange accent for status chips |

## Screen List

1. **Splash / Loading** — App icon + brand name while auth state loads
2. **Login** — Email + password login, "Join via Invitation" link
3. **Accept Invitation** — Driver enters invite code or follows deep link to join a company
4. **Loads (Home)** — Main dashboard with tab filter: New | Picked Up | Delivered | Archived
5. **Load Detail** — Full load info: map, vehicles, pickup/delivery addresses, status actions
6. **Vehicle Inspection — Pickup** — Step-by-step: vehicle info, damage wireframe, photos, signature
7. **Damage Marking** — Interactive car wireframe where driver taps to mark damage points
8. **Photo Capture** — Camera view for taking inspection/delivery photos
9. **Pickup Signature** — Customer signature pad
10. **Vehicle Inspection — Delivery** — Same as pickup inspection but for delivery
11. **BOL Viewer** — PDF preview of Bill of Lading with Send / Share options
12. **Profile** — Driver name, company, truck info, settings
13. **Notifications** — Push notification history (new load assigned, etc.)

## Primary Content & Functionality Per Screen

### Loads (Home)
- Tab bar: New | Picked Up | Delivered | Archived
- Each load card shows: Load ID, vehicle count, origin city → destination city, pickup/delivery dates, driver pay amount, payment type, status badge
- Pull-to-refresh
- FAB button for manually adding a load (optional, for owner-operators)
- Empty state illustration when no loads in a tab

### Load Detail
- Full-width map showing pickup pin and delivery pin with route line
- BOL button in top-right header
- Vehicle list: each vehicle shows year/make/model, VIN, damage count, photo count
- Pickup info section: address, contact, date/time
- Delivery info section: address, contact, date/time
- Status action button at bottom (context-aware):
  - If New → "Start Pickup Inspection"
  - If Inspection Started → "Continue Inspection"
  - If Picked Up → "Start Delivery Inspection"
  - If Delivered → "View BOL"

### Vehicle Inspection — Pickup
- Step indicator at top (Step 1 of 4, etc.)
- Vehicle info: year, make, model, VIN (with Scan VIN option)
- Damage wireframe: interactive SVG car diagram (top/front/rear/sides)
- Tap any zone to add damage: type (scratch, dent, chip, crack, missing), severity, photo
- Photo section: take or select photos (minimum 1 recommended)
- Notes field
- "Complete Inspection" → leads to signature pad

### Damage Marking
- SVG wireframe of vehicle (top-down view + front/rear views)
- Tap to place a damage pin
- Damage detail sheet slides up: type selector, severity, add photo
- Existing damage pins shown with numbered circles

### BOL Viewer
- Full-screen PDF preview of generated BOL
- Header actions: Send (email), Share (iOS share sheet), Print
- BOL contains: company info, driver info, vehicle list with damage notes, pickup/delivery signatures, photos

### Profile
- Driver avatar, name, phone
- Current company name + badge
- Truck/trailer info
- Settings: notifications, dark mode, location permissions
- Sign out

## Key User Flows

### Flow 1: Driver Receives and Accepts a New Load
1. Driver receives push notification: "New load assigned: Kansas City → Beverly Hills"
2. Driver opens app → Loads tab → "New" tab shows the load card
3. Driver taps load → Load Detail screen
4. Driver reviews pickup/delivery info and vehicle list
5. Driver taps "Start Pickup Inspection"

### Flow 2: Pickup Inspection
1. Inspection screen opens for first vehicle
2. Driver confirms/edits vehicle info (or scans VIN)
3. Driver taps damage wireframe to mark any pre-existing damage
4. Driver takes minimum photos (front, rear, sides)
5. Driver taps "Continue to Signature"
6. Customer signs on screen
7. Inspection saved → load status updates to "Picked Up" on dispatcher platform

### Flow 3: Delivery & BOL
1. Driver arrives at delivery location
2. Opens load → taps "Start Delivery Inspection"
3. Marks any new damage (compared to pickup)
4. Customer signs delivery
5. Load status updates to "Delivered" on dispatcher platform
6. Driver taps "BOL" → PDF preview opens
7. Driver taps "Send" → enters customer/broker email → BOL sent

### Flow 4: Joining a Company via Invitation
1. Dispatcher sends invite from web platform
2. Driver receives email/SMS with invite code
3. Driver opens app → "Join via Invitation" on login screen
4. Driver enters invite code → account linked to company
5. Driver now sees only loads assigned to them

## Layout & Navigation

- **Bottom Tab Bar**: Loads | Notifications | Profile (3 tabs, clean and minimal)
- **Stack navigation** within each tab for drill-down screens
- **Modal sheets** for damage detail, photo viewer, signature pad
- All screens use portrait orientation
- One-handed reachability: primary actions (CTAs) always at bottom of screen
- iOS Human Interface Guidelines compliant: standard navigation bars, system fonts, native feel
