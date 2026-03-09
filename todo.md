# AutoHaul Driver App — TODO

## Setup & Branding
- [x] Generate app logo/icon
- [x] Update theme colors (navy + orange brand palette)
- [x] Update app.config.ts with app name and logo
- [x] Set up icon symbol mappings for all tabs and icons

## Authentication
- [x] Login screen (email + password)
- [x] "Join via Invitation" flow with invite code entry
- [x] Auth context/provider with mock data for development
- [x] Persist auth state with AsyncStorage

## Navigation Structure
- [x] Bottom tab bar: Loads | Notifications | Profile
- [x] Stack navigators within each tab
- [x] Auth gate: redirect to login if not authenticated

## Loads Screen (Home)
- [x] Tab filter: New | Picked Up | Delivered | Archived
- [x] Load card component (Load ID, vehicles, route, dates, pay, status badge)
- [x] FlatList with pull-to-refresh
- [x] Empty state per tab
- [x] Mock load data for development

## Load Detail Screen
- [x] Map view with pickup/delivery pins and route line
- [x] BOL button in header
- [x] Vehicle list with damage/photo counts
- [x] Pickup info section
- [x] Delivery info section
- [x] Context-aware CTA button (Mark as Picked Up / Mark as Delivered / View BOL)
- [x] Status badge display
- [x] Tap-to-call for pickup and delivery contacts

## Pickup Inspection Flow
- [x] Vehicle info display (year, make, model, VIN, color)
- [x] Damage marking wireframe (12 tappable zones)
- [x] Damage detail modal (type, severity, notes)
- [x] Damage list with remove option
- [x] Photo capture (camera + photo library)
- [x] Notes field
- [x] Save inspection and update load context

## Delivery Inspection Flow
- [x] Reuses same inspection screen (detects pickup vs delivery by load status)
- [x] Save delivery inspection and update load status to "Delivered"

## BOL Screen
- [x] BOL document preview (rendered in-app as styled view)
- [x] Send BOL via email action
- [x] Share BOL via iOS share sheet
- [x] Print BOL action

## Profile Screen
- [x] Driver info display (name, email, company)
- [x] Truck/trailer info
- [x] Settings rows (notifications, location, app settings)
- [x] Sign out with confirmation

## Notifications Screen
- [x] Notification list with empty state

## Tests
- [x] Unit tests for all data helpers (getStatusLabel, getPaymentLabel, formatCurrency, formatDate)
- [x] Unit tests for mock data integrity (MOCK_LOADS, MOCK_DRIVER)

## Pending / Future
- [ ] VIN scanner (camera-based barcode scan)
- [ ] Signature pad for BOL
- [ ] Push notifications for new load assignments
- [ ] Backend API integration (replace mock data with real API)
- [ ] Driver invitation system (backend)
- [ ] Cloud photo upload
- [ ] Dark mode polish pass

## VIN Barcode Scanner
- [x] VIN scanner screen with live camera barcode scanning (Code39, Code128, PDF417, QR)
- [x] Auto-detect and decode VIN from barcode scan
- [x] VIN decode API integration (year, make, model, body type from VIN)
- [x] Manual VIN entry fallback on scanner screen
- [x] Wire scanner into inspection screen "Scan VIN" button
- [x] Auto-populate vehicle fields after successful scan

## Demo / Testing
- [x] Add "Enter Demo Mode" button to login screen to bypass auth for testing

## Company-Driver Invitation & Network System
- [x] Backend: driver_accounts table (id, name, email, phone, company_id, status)
- [x] Backend: company_invitations table (id, company_id, company_name, code, email, status, expires_at)
- [x] Backend: POST /api/invitations/generate — company generates invite code for a driver email
- [x] Backend: GET /api/invitations/:code — look up invite details by code (company name, status)
- [x] Backend: POST /api/invitations/accept — driver accepts invite, links to company (one company only)
- [x] Backend: GET /api/company/:id/drivers — company sees their full driver fleet
- [x] Backend: DELETE /api/company/:id/drivers/:driverId — company removes a driver
- [x] Driver app: Invitation code entry screen (already exists, needs real API wiring)
- [x] Driver app: Company preview screen — show company name/logo before confirming join
- [x] Driver app: Block joining if driver already belongs to a company
- [x] Driver app: Show current company info on profile screen
- [x] Driver app: Leave company option on profile screen
- [x] Dispatch platform: Invite Driver modal (enter driver name + email, generate code)
- [x] Dispatch platform: Drivers tab/section showing fleet (name, email, phone, status, joined date)
- [x] Dispatch platform: Pending invitations list (email, code, sent date, expiry)
- [x] Dispatch platform: Resend / revoke invitation actions
- [x] Dispatch platform: Remove driver from fleet action

## Add New Load Feature
- [x] Floating action button (FAB) on loads screen with expand animation
- [x] FAB expands to show "Add New Load" and "Scan VIN" options
- [x] Add New Load modal — Vehicle section (Scan VIN or Enter Manually)
- [x] Add New Load modal — Pickup Information section
- [x] Add New Load modal — Delivery Information section
- [x] Add New Load modal — Shipper/Customer Information section
- [x] Add New Load modal — Payment Information section
- [x] Add New Load modal — Expenses section
- [x] Add New Load modal — Attachments section
- [x] VIN scan from Add Load flow auto-fills year, make, model, color, body type
- [x] Save new load to loads context and show in New tab

## VIN Scanner Fix & Improvements
- [x] Fix VIN scan return flow — populate all vehicle fields (VIN, year, make, model, body type) after scan
- [x] Manual VIN entry: accept last-6 digits only (unique serial) or full 17-digit VIN
- [x] Add Lot Number field to vehicle form
- [x] Show decoded vehicle summary card after successful scan (year, make, model, body type, engine)
- [x] Handle partial VIN (last-6) gracefully — mark as manually entered, not verified

## Post-VIN Confirm → New Load Flow
- [ ] After VIN confirm, navigate to add-load screen with vehicle pre-filled
- [ ] Vehicle summary banner at top of add-load (VIN, year, make, model, type — locked/read-only)
- [ ] All sections: Pickup Info, Delivery Info, Shipper/Customer, Payment, Expenses, Attachments
- [ ] "Continue to Pickup Signature" CTA button at bottom
- [ ] Attachments section with photo grid (camera + library)

## GPS Auto-Location for Pickup & Delivery
- [x] Install expo-location package
- [x] Add location permission to app.config.ts
- [x] Add "Use My Current Location" GPS button to Pickup address field
- [x] Add "Use My Current Location" GPS button to Delivery address field
- [x] Reverse-geocode GPS coordinates into full street address (street, city, state, zip)
- [x] Show loading spinner while fetching location
- [x] Handle permission denied gracefully with user-friendly alert

## Per-Vehicle Pickup Inspection on Overview Screen
- [x] Add inspection state to FormVehicle (damages, photos, notes, inspectionComplete flag)
- [x] Add "Start Pickup Inspection" button to each vehicle card on the Overview screen
- [x] Show green "Inspection Complete" badge on vehicle card after inspection is saved
- [x] Build inline inspection modal: damage wireframe (12 zones), photo capture, notes
- [x] Damage selector bottom sheet (type, severity, location)
- [x] Photo grid with camera and library options per vehicle
- [x] Save inspection back to vehicle state and return to Overview
- [x] Multiple vehicles each get independent inspection status
- [x] Show inspection summary on vehicle card (damage count, photo count)

## Inspection Photo UX Overhaul
- [x] Replace single-shot camera with a multi-shot photo session modal
- [x] Photo session: full-screen camera view with "Take Photo" button — keeps camera open after each shot
- [x] Show live thumbnail strip at bottom of camera showing photos taken so far
- [x] "Done" / "Submit Photos" button to finish the session and return all photos at once
- [x] Allow deleting a photo from the thumbnail strip before submitting
- [x] Show running count badge (e.g. "3 photos") while in session
- [x] After session ends, photos appear in the inspection photo grid
- [x] Add quick-access photo count badge on the inspection modal header
- [x] Add "Retake" option on individual thumbnails in the photo grid
- [x] Auto-suggest required shots: Front, Rear, Driver Side, Passenger Side, Odometer, VIN plate
- [x] Show required shot checklist with checkboxes that auto-check as photos are added

## Offline Photo Queue
- [x] Read server README and filesystem docs to understand upload endpoint and local storage API
- [x] Create photo queue store: persist queue entries (id, localUri, loadId, vehicleId, status) to AsyncStorage
- [x] On photo capture: copy from temp cache to permanent app documents directory
- [x] Add upload queue entry with status: pending | uploading | done | failed
- [x] Add server endpoint: POST /api/photos/upload — accepts multipart/form-data, stores to S3, returns URL
- [x] Background sync service: watch network state, auto-upload pending entries when online
- [x] Retry logic: failed uploads retry up to 3 times with exponential backoff
- [x] Replace local URI with S3 URL in vehicle inspection data after successful upload
- [x] Show upload status indicator on inspection photo thumbnails (pending/uploading/done/failed)
- [x] Show global sync status banner when uploads are in progress or failed
- [x] No photos saved to device camera roll

## Camera UI Redesign (SuperDispatch-style)
- [x] Full-screen live camera viewfinder (no modal nesting, native fullscreen)
- [x] Vertical thumbnail strip on the right side showing all captured photos
- [x] Large centered shutter button (blue circle like SuperDispatch)
- [x] Photo/Video mode toggle on the left side
- [x] Flash toggle on the left side
- [x] Zoom level indicator (0.5x / 1x) on left side
- [x] "Done" button top-right to finish session
- [x] Video mode: 30-second max recording with live timer
- [x] Camera stays open entire session (200+ photos supported)
- [x] Thumbnail strip scrollable vertically, tap to delete
- [x] Works on real device via Expo Go (native camera, not web preview)

## Bug Fixes
- [x] Camera not opening when "Take Photos" is tapped after VIN scan (root cause: nested Modal blocked by iOS pageSheet — fixed by lifting PhotoSessionModal to root screen level in add-load.tsx)
- [x] Deep-fix: camera still not opening after "Take Photos" tap — root cause was iOS blocking Modal inside fullScreenModal. Fix: camera-session is now a dedicated top-level route (/camera-session) registered as fullScreenModal in root Stack. Data flows via cameraSessionStore (global callback store). router.push("/camera-session") from inspection modal navigates to it cleanly.

## Driver/Company Identity & Invitation System
- [x] Database: add driverCode (D-XXXXX) column to driver_profiles
- [x] Database: add companyCode (C-XXXXX) column to companies
- [x] Database: create driver_company_links table (many-to-many, status: pending/active/declined/removed)
- [x] Backend: auto-generate unique D-XXXXX code on driver first login
- [x] Backend: auto-generate unique C-XXXXX code on company registration
- [x] Backend: drivers.getProfile — get or create driver profile with D-XXXXX code
- [x] Backend: companies.inviteDriverByCode — company sends invite by D-XXXXX code
- [x] Backend: drivers.respondToInvite — accept or decline invite
- [x] Backend: drivers.getConnections — list all active company connections
- [x] Backend: drivers.getMyPendingInvites — list all pending invites
- [x] Backend: drivers.disconnectFromCompany — driver removes a company connection
- [x] Backend: companies.removeDriver — company removes driver from roster
- [x] Mobile: Profile screen shows D-XXXXX code with copy button
- [x] Mobile: Profile screen shows pending invites with Accept/Decline per company
- [x] Mobile: Profile screen shows connected companies with Disconnect option
- [x] Mobile: Driver can be connected to multiple companies simultaneously
- [x] Mobile: Drivers screen shows D-XXXXX code on each driver card
- [ ] Mobile: Drivers screen — add "Invite by Driver ID" field alongside legacy code invite
- [ ] Push notification: driver notified when company sends invite
- [ ] Push notification: driver notified when load is assigned

## Join a Company Flow — Audit & Fix
- [x] Audit: read profile screen to understand current "Join a Company" UI
- [x] Audit: read backend routes to understand what invite/join endpoints exist
- [x] Audit: check auth context to understand how company connections are stored
- [x] Fix: ensure driver can enter C-XXXXX company code to request to join
- [x] Fix: backend routes added: driver.lookupCompanyByCode and driver.requestJoinByCompanyCode
- [x] Fix: show company preview (name, C-XXXXX code, email) before driver confirms join
- [x] Fix: after joining, show company in "Connected Companies" list on profile
- [x] Fix: handle already-connected, already-pending, and not-found error states
- [x] Fix: removed incorrect "one company at a time" warning (drivers can connect to multiple)
- [x] Fix: invite screen now supports both C-XXXXX company codes AND legacy 8-char invite codes
- [x] Fix: auto-detects code type and shows appropriate preview and confirmation flow

## Driver ID Visibility Fix
- [x] Show D-XXXXX code as a large, prominent card at the very top of the Profile/Settings screen
- [x] Show a demo placeholder card in Demo mode explaining what the Driver ID is and how to get one
- [x] One-tap copy button on the ID card (Copy button with checkmark confirmation)

## Driver ID Share Button
- [x] Add native Share sheet button next to Copy on the Driver ID card
- [x] Share message: "My AutoHaul Driver ID is D-XXXXX — add me to your fleet on AutoHaul."

## Push Notifications
- [x] Create server/push.ts — Expo Push API helper for sending to driver device tokens
- [x] Register push token on login and save to driver profile via driver.updateProfile
- [x] Set up notification response listener in root layout (routes taps to correct screen)
- [x] Android notification channels: default, invites, loads
- [x] Backend: send push notification when company invites a driver (inviteDriverByCode route)
- [ ] Backend: send push notification when a load is assigned to a driver (requires server-side load assignment)

## Login Screen Update
- [x] Update "Join with Invitation Code" button label to "Join a Company"
- [x] Update help text to mention both C-XXXXX company ID and invitation code methods

## Demo Driver Account
- [x] Create real demo driver user + profile in database with fixed D-XXXXX code (D-00001)
- [x] Wire demo driver ID into app Demo mode so it displays the real code (MOCK_DRIVER.driverCode = "D-00001")
- [x] Display demo driver ID prominently with blue card, Copy and Share buttons
- [x] Demo card hint text: "This is your demo Driver ID. Use it on the company platform to test load assignments."

## Company Platform API Integration
- [ ] Explore company platform API endpoints (invites, connections, loads)
- [ ] Understand authentication model for driver app → company platform calls
- [ ] Build API client layer in driver app pointing to company platform
- [ ] Replace local invite/connection routes with company platform API calls
- [ ] Update Profile screen pending invites to pull from company platform
- [ ] Update Profile screen connected companies to pull from company platform
- [ ] Update Loads screen to fetch assigned loads from company platform
- [ ] Push notification when load is assigned (via company platform webhook or polling)

## Company Platform API Integration (Active)
- [x] Create server/company-platform-client.ts — typed API client for company platform tRPC endpoints
- [x] Add tRPC route: loads.getAssigned — fetches real loads from company platform by driverCode
- [x] Add tRPC route: loads.submitInspectionReport — submits inspection photos + damages to company platform
- [x] Add tRPC route: loads.updateTripStatus — marks trip as picked_up or delivered on company platform
- [x] Update loads-context to fetch real loads from company platform (merge with local loads)
- [x] Update inspection save flow to call submitInspectionReport after saving locally
- [x] Update load detail status buttons to call updateTripStatus on company platform
- [x] Add API key validation test to confirm connectivity
- [x] Handle API errors gracefully (offline fallback to local data)

## Full Load Lifecycle Flow
- [x] Remove mock loads from Loads screen when real driver is authenticated (show only platform loads + manually added)
- [x] Show "No Pending Loads" empty state with driver D-XXXXX code pill when platform returns empty array
- [x] Add loading spinner on Loads screen while fetching platform loads ("Checking for assigned loads...")
- [x] Ensure picked_up and delivered status sync correctly to company platform via updateTripStatus
- [x] Update status labels: "Pending Pickup" (new), "Picked Up", "Delivered"
- [x] Update tab labels: "Pending", "Picked Up", "Delivered", "Archived"
- [x] Note: registerDriver not available on company platform API — matching is done by dispatcher via D-XXXXX code

## Demo Driver ID
- [x] Add server route demo.getOrCreateProfile (public, device-keyed) to generate real D-XXXXX
- [x] Update auth-context demo login to call server and get a real persistent driverCode
- [x] Store real driverCode in AsyncStorage so it persists across app restarts
- [x] Auto-upgrade existing D-00001 codes to real server codes on app startup
- [x] Profile screen already shows D-XXXXX prominently with Copy + Share buttons
- [x] Note: MOCK_DRIVER.driverCode kept as D-00001 fallback only (used if server unreachable)

## Remove Driver-Initiated Join Company Flow
- [x] Remove "Join a Company" button from login screen
- [x] Note: join-company screen was inline in invite.tsx — removed the button that navigated to it
- [x] Remove company connection UI from Profile screen (pending invites, connected companies, disconnect button)
- [x] Replace Profile company section with 3-step "How to Receive Loads" explainer pointing to D-XXXXX code
- [x] Fix error: lookupCompanyByCode was querying local DB for a company platform C-XXXXX code (removed the flow entirely)

## Driver Invite Flow — Company → Driver
- [x] Probe company platform API for getPendingInvites and respondToInvite endpoints
- [x] Add invite endpoints to company platform (done by company platform task)
- [x] Add getPendingInvites and respondToInvite to company-platform-client.ts
- [x] Add tRPC routes: invites.getPending and invites.respond (proxy to company platform)
- [x] Restore pending invites section on Profile screen with Accept/Decline buttons
- [x] Wire Accept → company platform API (marks driver as Active in company roster)
- [x] Wire Decline → company platform API
- [x] Auto-refresh invites every 30 seconds while app is open
- [x] Show invite count badge on Profile screen header when invites exist
- [x] Confirmation alert before accepting or declining
- [x] Success message after accepting with instructions to refresh Loads tab

## Fix Accept Invitation Bug (Active)
- [ ] Probe getPendingInvites response to find actual invite ID field name (inviteId vs id)
- [ ] Fix inviteId mapping in Profile screen and tRPC invites.respond route

## Multi-Photo Inspection Session (200 Photos)
- [x] Replace single-shot "Add Photo" button on inspection screen with "Take Photos" button that opens camera-session
- [x] Camera session supports up to 200 photos per vehicle (remove any hard cap)
- [x] Camera stays open continuously — driver taps shutter as many times as needed
- [x] Thumbnail strip on right side shows all captured photos in real-time
- [x] "Done (N)" button in top-right finishes session and returns all photos at once
- [x] All photos save and upload in batch when Done is tapped (not one-by-one)
- [x] Existing photos shown in grid on inspection screen with count badge
- [x] Remove photo from grid with X button after session
- [x] Photo library picker still available as secondary option alongside camera session

## GPS + Timestamp Photo Stamping (Chain of Custody)
- [x] Request location permission before camera session opens
- [x] Capture GPS coordinates at the moment each photo is taken
- [x] Burn timestamp (date + time) and GPS coordinates as a visible overlay onto each photo
- [x] Overlay styled like a professional evidence stamp (dark banner at bottom of image)
- [x] Include driver code / company name in stamp for full traceability
- [x] Stamping happens before photo is added to the session thumbnail strip
- [x] Graceful fallback if location permission denied (timestamp only, no GPS)

## Load Detail Screen Display Bugs
- [x] Vehicle shows "null" instead of year/make/model (e.g. "2021 Toyota Camry")
- [x] Pickup phone number not displaying (blank even though platform has it)
- [x] Delivery phone number not displaying (blank even though platform has it)
- [x] Pickup/Delivery dates show "Dec 31, 1969" (Unix epoch zero bug)

## Contact Name Display on Load Detail
- [x] Show contact person name (e.g. "Contact: Mike") alongside phone number in Pickup Information section
- [x] Show contact person name (e.g. "Contact: Declan") alongside phone number in Delivery Information section
- [x] Pass contactName through from platform API mapper to ContactInfo.name field
- [x] Display as a dedicated "Contact" row in the info card

## legId Fix & VIN Display (Current Session)
- [x] Fix: platform API returns `legId` not `tripId` — update PlatformLoad type and mapper to use legId
- [x] Fix: platform API returns status `"assigned"` — add to status map (treat as "pending")
- [x] Fix: VIN now populated by platform — verify it displays correctly in load detail
- [x] Fix: duplicate React key error — use legId instead of tripId as local load ID

## Load Detail UX Enhancements
- [x] Tap-to-copy phone numbers (clipboard + haptic feedback + visual confirmation)
- [x] Tap-to-navigate addresses (open Maps app with directions)
- [ ] Auto-refresh loads after accepting an invite

## Photo Upload Reliability
- [x] Debug S3/R2 upload pipeline — root cause: wrong URL path (/trpc/ instead of /api/trpc/)
- [x] Fix photo upload URL path in photo-queue-class.ts
- [x] Fix tRPC response parsing (result.data.json.url format)
- [x] Add retry button for failed uploads in inspection screen

## Onboarding & Sign-Up Flow
- [x] Welcome/landing screen shown on first launch (logo, tagline, Sign In + Create Account buttons)
- [x] Sign-up screen: full name, email, password, confirm password
- [x] Sign-up wired to backend auth (create user + driver profile)
- [x] After sign-up, auto-navigate to the main app (logged in)
- [x] "Already have an account? Sign In" link on sign-up screen
- [x] "Don't have an account? Create one" link on sign-in screen

## Driver Lookup Bug (D-97071)
- [x] Diagnose: driver D-97071 registered in mobile app but platform "Invite Driver" returns "Driver not found"
- [x] Fix: ensure driver profiles created via mobile app register flow are discoverable by the platform's inviteDriverByCode

## Platform Driver Registration Sync
- [x] Call platform driversApi.registerDriver after login/register so driver is discoverable by dispatchers
- [x] Store platform URL as a constant so it can be updated easily

## Platform ID Mismatch Fix
- [x] Call platform registerDriver on first login/register and store the returned platform driverId
- [x] Display the platform driverId (not the local D-XXXXX) on the Profile tab as the "Share with dispatchers" code
- [x] Update the auth-context to store and expose platformDriverId separately from local driverCode

## Invite Acceptance Fix
- [x] Fix invite fetch to use platformDriverCode (D-18589) not local driverCode (D-97071)
- [x] Fix invite accept/decline to use platformDriverCode
- [x] Ensure pending invites appear on Profile tab after sign-in

## My Companies (Settings)
- [x] Fetch list of companies the driver has joined from the platform API
- [x] Display connected companies in a "My Companies" section on the Profile tab
- [x] Show company name, status (active/pending), and a Leave button for each
- [x] Confirm before leaving a company (Alert dialog)
- [x] Call platform disconnect endpoint on leave and refresh the list

## Phone-Number Identity (Anti-Spam)
- [x] Replace email/password auth with phone number → one permanent driver ID per phone
- [x] Phone entry screen: enter phone number with country code selector
- [x] OTP verification screen: 6-digit code entry (device-fingerprint mode, Twilio-ready)
- [x] Backend: phone_auth_sessions table + phone_verified column on driver_profiles
- [x] Backend: phoneAuth.sendCode and phoneAuth.verifyCode tRPC endpoints
- [x] Backend: if phone already exists, return the existing driver ID (no duplicates)
- [x] Backend: phone-auth.ts abstraction layer — swap to Twilio by changing one file
- [x] Welcome screen: "Continue with Phone Number" as primary CTA, email as legacy fallback
- [x] Existing email sessions remain valid (no forced migration)

## UI Bug Fixes (Feb 22)
- [x] Fix: Loads empty state shows local driverCode (D-97071) instead of platformDriverCode (D-18589)
- [x] Fix: Profile screen EQUIPMENT and SETTINGS section headers clipped on left edge

## My Companies Visibility Bug
- [x] Fix: My Companies section not visible on Profile tab (may be hidden, not rendering, or below scroll area)
- [x] Root cause: invites.respond mutation was not creating local DB records when accepting an invite
- [x] Root cause: getMyConnections used protectedProcedure (requires server session) but phone-auth drivers have no server session
- [x] Fix: Added db.acceptPlatformInvite() to create company + driver_company_links records on invite acceptance
- [x] Fix: Added getMyConnectionsByCode public endpoint (uses driverCode, no session required)
- [x] Fix: Added disconnectFromCompanyByCode public endpoint (uses driverCode, no session required)
- [x] Fix: invites.respond now passes localDriverCode + companyCode + companyName to enable local record creation
- [x] Fix: Profile screen now uses getMyConnectionsByCode so phone-auth drivers see their companies
- [x] Fix: My Companies section refreshes immediately after accepting an invite (refetchConnections on success)
- [x] Fix: Phone number passed to platform registerDriver on phone-auth login (was using empty string before)

## Create Account Phone Number Field Bug
- [x] Fix: Phone number input field not visible on the Create Account / sign-up screen
- [x] Added Phone Number field between Full Name and Email on register.tsx
- [x] Updated register() in auth-context.tsx to accept optional phone parameter
- [x] Phone number passed to platform registerDriver on email-based sign-up

## OTP Verification After Create Account
- [x] After submitting Create Account form, send OTP to the entered phone number
- [x] Navigate to phone-verify screen with phone number pre-filled (name pre-filled too)
- [x] On OTP success, complete registration (store name, email, phone, driverCode via loginWithPhone)
- [x] Added country code selector (+1/+44/+61/+52) to the phone field on Create Account screen
- [x] Added info note: "After submitting, you'll receive a verification code to confirm your phone number"
- [x] Button label changed from "Create Account" to "Continue →" to reflect the two-step flow
- [x] Push notification error (projectId warning) — harmless in Expo Go dev mode, can be dismissed

## Platform Driver Code Not Stored / Displayed Bug
- [x] Fix: Driver signs up with email (igor4375@gmail.com), gets local ID D-97071, but platform doesn't know this ID
- [x] Root cause: platformDriverCode is not stored when platform server is asleep during sign-up (registerWithPlatform returns null)
- [x] Root cause: loginWithPhone passed empty string as email to registerWithPlatform, causing silent failure
- [x] Fix: Auto-retry platform registration on app startup for ALL drivers missing platformDriverCode (not just email-based)
- [x] Fix: Added syncWithPlatform() function exposed from AuthContext for manual retry
- [x] Fix: Profile screen shows "Get Invite Code" button when platformDriverCode is missing
- [x] Fix: Tapping "Get Invite Code" calls syncWithPlatform() and shows success/failure alert
- [x] Fix: Profile screen now imports syncWithPlatform from useAuth()

## Auth Flow Rebuild — Phone-Only
- [ ] Remove email/password login screen entirely
- [ ] Remove Create Account screen (register.tsx) — phone OTP is the only way in
- [ ] Welcome screen: single "Continue with Phone Number" button only
- [ ] Phone entry → OTP verify → if new user, enter name → into app
- [ ] If existing user (phone already registered), OTP verify → straight into app
- [ ] Logout stores nothing — next open requires phone + OTP again
- [ ] Any phone number that hasn't gone through OTP cannot access the app
- [ ] End-to-end tested: new user, existing user, logout + re-login

## Auth Flow Rebuild — Phone-Only
- [x] Remove email/password login from welcome.tsx (phone-only CTA)
- [x] Remove code display box from phone-verify.tsx (was showing OTP on screen)
- [x] Add 30-second resend cooldown timer to phone-verify.tsx
- [x] Rewrite auth-context.tsx to be phone-only (removed login() and register() email/password functions)
- [x] login.tsx and register.tsx now redirect to phone-entry (legacy screens removed)
- [x] 14 new auth flow tests added and passing
- [x] OTP is single-use and server-validated (incorrect code is rejected)
- [x] New users must enter name on verify screen; existing users log in without name
- [x] loginWithPhone builds a proper Driver object (no MOCK_DRIVER spread)

## Platform Driver Code DB Fix (Feb 22 — D-24386 issue)
- [x] Root cause: platform_driver_code column was missing from driver_profiles DB table
- [x] Root cause: platform registration happened client-side (auth-context.tsx) — failed silently when platform was sleeping
- [x] Fix: Added platform_driver_code column to driver_profiles schema + ran DB migration
- [x] Fix: Platform registration now happens SERVER-SIDE inside phoneAuth.verifyCode mutation
- [x] Fix: platformDriverCode saved to DB — survives app reinstalls and device changes
- [x] Fix: Added companyPlatform.registerDriver() to company-platform-client.ts
- [x] Fix: Added phoneAuth.syncPlatformCode tRPC endpoint for server-side retry
- [x] Fix: syncWithPlatform() in auth-context now calls server-side syncPlatformCode endpoint (not client-side platform call)
- [x] Fix: loginWithPhone() accepts platformDriverCode from verifyCode result (no more client-side platform calls)
- [x] Fix: "Get Invite Code" button on Profile calls syncWithPlatform → server-side syncPlatformCode → saves to DB

## Single Driver ID Unification
- [ ] Remove "Get Invite Code" button from Profile screen entirely
- [ ] Remove all sync warnings and "platform sync pending" states from UI
- [ ] Use local driverCode (D-XXXXX) as the ONE permanent driver ID everywhere
- [ ] Platform registration happens silently in background — driver never sees or waits for it
- [ ] Remove platformDriverCode as a separate concept from auth-context and profile UI
- [ ] Company platform must accept the local driverCode directly for invite lookup
- [ ] Background retry: if platform registration fails, retry silently on next app open — no user action needed

## Single Driver ID Unification
- [x] Remove platformDriverCode concept entirely — one phone = one D-XXXXX ID, period
- [x] Remove platformDriverCode from Driver type in data.ts
- [x] Remove syncWithPlatform() from auth-context.tsx
- [x] Remove "Get Invite Code" button from Profile screen
- [x] Remove "Your invite code is not yet synced" warning from Profile screen
- [x] Profile screen now shows driverCode directly — no fallback, no sync needed
- [x] index.tsx EmptyState now uses driverCode directly (no platformDriverCode fallback)
- [x] Platform registration now happens silently in background (silentlyRegisterWithPlatform)
- [x] Driver is never blocked, never shown a sync button, never confused by two IDs
- [x] 79 tests pass after cleanup

## Company Platform Driver Lookup Fix
- [ ] Investigate: company platform inviteDriverByCode queries its own separate DB, not the driver app DB
- [ ] Fix: company platform must be able to find drivers registered in the driver app by D-XXXXX code
- [ ] Fix: when driver app registers a driver, also register them in the company platform's driver registry
- [ ] Verify: entering D-24386 on company platform finds Martin (+12043846095)

## Platform Driver ID Integration Fix (v2)
- [ ] Update registerDriver in company-platform-client.ts to pass driverCode field
- [ ] Update verifyCode mutation to store platform-assigned driverId (not local driverCode) as platformDriverCode in DB
- [ ] Re-enable platformDriverCode display on Profile screen as the shareable "Dispatcher Invite Code"
- [ ] Add retry logic (3s delay) if platform is sleeping during registration
- [ ] Test end-to-end: sign up → get platform ID → dispatcher finds driver by that ID

## Platform Driver ID Integration Fix (v2) — COMPLETED
- [x] Update registerDriver in company-platform-client.ts to pass driverCode field in batch API format
- [x] Update verifyCode mutation to store platform-assigned driverId as platformDriverCode in DB
- [x] Re-enable platformDriverCode display on Profile screen as the shareable "Dispatcher Invite Code"
- [x] Profile screen shows platformDriverCode when available, falls back to local driverCode
- [x] Loads screen empty state shows platformDriverCode (the ID dispatchers search for)
- [x] Fix TypeScript errors (driverCode null → undefined in registerDriver calls)
- [x] Add 3 new integration tests for registerDriver batch format (all passing)
- [x] All 82 tests pass after changes

## Driver Not Found Bug (Feb 22 — D-11903) — FIXED
- [x] Diagnose: dispatcher enters D-11903 on company platform "Invite Driver" modal but gets "Driver not found with this ID"
- [x] Root cause: Profile screen was showing local driverCode (D-11903) instead of platform-assigned platformDriverCode (D-68544)
- [x] Fix: Add platformDriverCode to Driver type in data.ts
- [x] Fix: Pass platformDriverCode from verifyCode response to loginWithPhone in phone-verify.tsx
- [x] Fix: Add public getProfileByCode endpoint to fetch latest platformDriverCode from DB
- [x] Fix: Update Profile screen to use DB-fetched platformDriverCode as primary source (not session-gated getMyProfile)
- [x] Fix: Update LoadsProviderWithAuth to use platformDriverCode for fetching loads from company platform
- [x] Fix: Handle existing sessions (platformDriverCode missing from AsyncStorage) by fetching from DB on app open
- [x] All 89 tests pass after changes

## Profile Screen Overhaul (Feb 22)
- [x] Fix Driver ID card: display code on a single line (no line wrapping)
- [x] Equipment section: replace capacity fields with Truck Number + Trailer Number text inputs
- [x] Equipment section: add Capacity picker (1–10 vehicles)
- [x] Equipment section: add Equipment Type selector (Tow Truck, Flatbed, Stinger, 7-Car Carrier)
- [x] Notifications section: add "New Load Assigned" toggle (default ON)
- [x] Notifications section: add "Company Invite Received" toggle (default ON)
- [x] Persist notification preferences to DB via updateProfileByCode endpoint
- [x] Persist equipment type and capacity to DB via updateProfileByCode endpoint

## My Companies Screen & Connection Fix (Feb 22)
- [x] Diagnose: why Artur (D-68544) can't see his joined companies — check DB connection records
- [x] Root cause: invites.respond handler silently skipped local DB write when localDriverCode was missing
- [x] Fix: invites.respond now looks up profile by platformDriverCode OR localDriverCode to always save connection
- [x] Fix: added getDriverProfileByPlatformCode DB function for reliable lookup
- [x] Build: dedicated My Companies screen at app/my-companies.tsx
- [x] My Companies screen: list all active connections with company name, code, status badge
- [x] My Companies screen: "Leave" action per company with confirmation dialog
- [x] My Companies screen: pull-to-refresh support
- [x] My Companies screen: empty state with back-to-profile button
- [x] Profile screen: replace inline companies list with single "My Companies" row + count badge
- [x] Profile screen: tapping "My Companies" row navigates to the dedicated screen
- [x] All 95 tests pass after changes

## Company Platform Sync (Feb 22)
- [ ] Probe company platform API for getConnectedCompanies endpoint
- [ ] Add getConnectedCompanies to company-platform-client.ts
- [ ] Add tRPC route: driver.syncCompaniesFromPlatform — fetch from platform, upsert into local DB
- [ ] Trigger sync on app open (in LoadsProviderWithAuth or _layout.tsx)
- [ ] Trigger sync on My Companies screen pull-to-refresh
- [ ] Handle case where company doesn't exist in local companies table (create stub record)

## Load Card Vehicle Info (Feb 22)
- [x] Show vehicle year/make/model on load card instead of "X Vehicle(s)" count
- [x] Single vehicle: show "2021 Toyota Camry" (year make model)
- [x] Multiple vehicles: show "2021 Toyota Camry & 2 more"
- [x] Fallback to "X Vehicle(s)" if vehicle data is missing

## Loads Screen Stats Bar (Feb 22)
- [x] Add stats bar below the tab selector on the Loads screen
- [x] Stat 1: unique pickup locations (deduplicated by city+address)
- [x] Stat 2: unique drop-off locations (deduplicated by city+address)
- [x] Stat 3: total vehicles across all loads in current tab
- [x] Stats update when switching tabs (Pending / Picked Up / Delivered / Archived)
- [x] Stats bar hidden when tab has no loads (empty state)

## Vehicle Info Mapping Bug (Feb 22) — FIXED
- [x] Load card PAT-2026-00001 shows "1 Vehicle" instead of "2021 Toyota Camry"
- [x] Load detail shows "Unknown Vehicle" instead of "2021 Toyota Camry" above VIN
- [x] Root cause: platform returns year/make/model as null but stores full name in `description` field
- [x] Fix: parse "YYYY Make Model" from description when structured fields are null
- [x] Fix: bumped PLATFORM_LOADS_KEY to v5 to clear stale cached data
- [x] All 82 tests pass after fix

## Header & Load Order Improvements (Feb 22)
- [x] Sort loads newest-first (most recently assigned/created at top of list)
- [x] Compact header: single-line "Welcome back, Artur" (no line break)
- [x] Show driver ID inline in the header row (below the name, same compact block)

## Load Card Route Display Preference (Feb 22)
- [x] Add "Route Display" setting to Profile/Settings screen (City/State vs Facility Name)
- [x] Persist preference to AsyncStorage
- [x] Load card pickup/dropoff labels respect the setting (show city or facility name)
- [x] Gracefully fall back to city if facility name is missing

## Header Single-Line Compact (Feb 22)
- [x] Merge "Welcome back, Artur" and driver ID onto one single line in the header

## Header Driver ID Mismatch Fix (Feb 22)
- [ ] Header shows D-11903 (local code) instead of D-68544 (platform code) — fix to always show platform code

## Maps App Preference (Feb 22)
- [x] Add mapsApp preference (apple | google) to settings context, persisted to AsyncStorage
- [x] On first address tap show a one-time picker sheet: Apple Maps or Google Maps
- [x] Open correct maps app based on saved preference on subsequent taps
- [x] Add Maps App toggle to Profile > Display section so driver can change it later

## Map Replacement (Feb 22)
- [x] Remove broken MapView from load detail, replace with clean route card (pickup city → delivery city)

## Expenses Feature (Feb 22)
- [x] Add expenses DB table (id, loadId, driverCode, label, amount, date, receiptUrl, createdAt)
- [x] Add tRPC endpoints: addExpense, getExpensesByLoad, deleteExpense
- [x] Add file storage upload for receipt photos (S3)
- [x] Build Expenses section in load detail: photo capture, label/amount/date form, saved list
- [ ] Expose expenses via company platform API endpoint

## Vehicle Overview Improvements (Feb 22)
- [x] Add last 6 of VIN beside each vehicle name in the load card overview
- [x] Remove redundant pickup/delivery summary row above vehicle list on load cards

## Vehicle Overview Improvements (Feb 22)
- [x] Add last 6 of VIN beside each vehicle name in the load card overview
- [x] Remove redundant pickup/delivery summary row above vehicle list on load cards

## Load Detail Cleanup (Feb 22)
- [x] Remove redundant PICKUP/DELIVERY route card from top of load detail screen

## Expense Modal Keyboard Fix (Feb 22)
- [x] Fix Add Expense modal: text fields hidden behind keyboard — add KeyboardAvoidingView/scroll

## Expense Form Improvements (Feb 22)
- [x] Add quick-select category chips (Loading Fee, Fuel, Toll, Other) above label field
- [x] Replace manual date text input with native date picker

## Expense Form - Other Chip Auto-Focus (Feb 22)
- [x] Auto-focus custom label field when Other chip is tapped

## Expense Form - Notes Field (Feb 22)
- [x] Add optional Notes text area to Add Expense form (DB column + server + UI)

## Inspection Flow Redesign (Feb 22)
- [ ] Camera launches immediately when tapping Start Pickup Inspection
- [ ] After Done in camera, transition to interactive vehicle condition diagram
- [ ] Interactive car diagram with top/side views — tap to place damage markers
- [ ] Damage type picker (Scratch, Dent, Broken, Chipped, Missing, Multiple Scratches)
- [ ] Damage markers shown as pinned badges on the diagram
- [ ] Markers tappable to edit or delete

## Inspection Flow Redesign (Feb 22)
- [x] Camera-first: Start Pickup Inspection opens camera immediately
- [x] After Done in camera, auto-navigate to inspection condition report screen
- [x] Replace abstract zone-pin wireframe with SVG car diagram (top + side views)
- [x] Tap-anywhere on diagram to place damage badge at exact position
- [x] Damage badges show abbreviation (S, D, CH, BR, MS) like Super Dispatch
- [x] Severity color coding: red=severe, amber=moderate, orange=minor

## Additional Inspection Screen (Feb 22)
- [x] Create additional-inspection screen route: /inspection/[loadId]/additional/[vehicleId]
- [x] Odometer reading text input
- [x] Notes (optional) text input
- [x] ADDITIONAL INSPECTION section: Drivable, Windscreen, Glasses (all intact), Title — YES/NO toggles
- [x] LOOSE ITEMS INSPECTION section: Keys/Remotes/Headrests (count picker 0-8), Cargo Cover/Spare Tire/Radio/Manuals/Navigation Disk/Plugin Charger Cable/Headphones — YES/NO toggles
- [x] Save button navigates back to load detail (router.dismiss(2))
- [x] Wire inspection screen Submit button to navigate to additional-inspection instead of load detail
- [x] Persist additional inspection data to vehicle inspection state via AdditionalInspection type

## Inspection Flow Navigation Bug Fix (Feb 22)
- [x] Camera Done goes back to load detail instead of damage diagram — traced: photos not passed to inspection screen
- [x] Fix: storePendingPhotos in camera callback, consumePendingPhotos on inspection screen mount
- [x] After fix: Camera → Damage Diagram (with photos) → Additional Inspection → Load Detail

## Inspection Flow - Definitive Navigation Fix (Feb 22)
- [x] Remove callback-based navigation (race condition with router.back)
- [x] Camera-session reads nextRoute from cameraSessionStore meta and does router.replace instead of router.back
- [x] Load detail sets meta.nextRoute = /inspection/loadId/vehicleId before pushing camera-session
- [x] router.replace goes directly to inspection screen (no back to load detail at all)
- [x] Changed inspection screens to fullScreenModal so router.replace works correctly

## Merge Additional Inspection into Damage Diagram Screen (Feb 22)
- [x] Add Odometer field to damage diagram screen (below Notes)
- [x] Add ADDITIONAL INSPECTION section: Drivable, Windscreen, Glasses (all intact), Title YES/NO toggles
- [x] Add LOOSE ITEMS INSPECTION section: Keys/Remotes/Headrests (Choose pickers 0-8), Cargo Cover/Spare Tire/Radio/Manuals/Navigation Disk/Plugin Charger Cable/Headphones YES/NO toggles
- [x] Persist all new fields to VehicleInspection.additionalInspection state
- [x] Save button goes directly to load detail (router.dismiss(1))
- [x] Separate additional inspection screen kept but removed from flow

## Add Bill of Sale to Additional Inspection (Feb 22)
- [x] Add billOfSale field to AdditionalInspection type in data.ts
- [x] Add billOfSale state to inspection screen
- [x] Add Bill of Sale YES/NO toggle below Title in ADDITIONAL INSPECTION section
- [x] Include billOfSale in handleSave

## Photo Upload Bug Investigation (Feb 22)
- [x] Traced upload pipeline: server endpoint works, client format was wrong
- [x] Root cause: photo-queue-class.ts sent plain JSON POST instead of tRPC v11 batch format (?batch=1 + {"0":{"json":{...}}} wrapper)
- [x] Fix: updated fetch call to use ?batch=1 and correct batch body, parse array response correctly
- [x] Verified end-to-end: upload now returns real S3 CDN URL

## Photo Count Badge on Vehicle Cards (Feb 22)
- [x] Show pickup photo count on each vehicle card in load detail (blue badge with camera icon)
- [x] Show delivery photo count once delivery inspection is done (amber badge with camera icon)
- [x] Badge only appears when photo count > 0 (hidden when no photos taken)

## Move Vehicle Back to Pending (Feb 22)
- [x] Understand how vehicle-level pickup status is tracked (load-level vs vehicle-level)
- [x] Add revertVehicleToPickupPending function to loads-context (clears pickupInspection, reverts load to 'new' if no vehicles remain picked up)
- [x] Add 'Move Back to Pending' red button on vehicle card (only visible when vehicle has pickup inspection and load is picked_up)
- [x] Show confirmation alert with destructive action before reverting
- [x] Clears pickup inspection data when reverted (photos, damage marks, additional inspection fields)

## Bug Fixes - Status & Pending (Feb 23)
- [x] Fix "Clear Pickup Inspection" button - changed condition from loadStatus==picked_up to new||picked_up so it shows correctly
- [x] Remove auto-status-change from savePickupInspection (inspection save no longer changes load status)
- [x] Mark as Picked Up button already exists at bottom - removed the allPickupDone gate so driver can tap freely
- [x] Driver reviews trip details + adds expenses first, then taps "Mark as Picked Up" to change status

## Bug Fix - Mark as Picked Up button unresponsive (Feb 23)
- [x] Root cause: onPress was async with await updateStatusMutation.mutateAsync() - callTRPC throws if API key not set, silently swallowed by React Native Alert
- [x] Fix: removed async/await from onPress - updateLoadStatus fires synchronously, platform sync is fire-and-forget .catch()
- [x] Same fix applied to handleMarkDelivered

## UX Improvements - Vehicle Card & Post-Pickup Flow (Feb 23)
- [x] Auto-navigate back to loads list after Mark as Picked Up confirmation (router.back() added)
- [x] Move Back to Pending now keeps inspection data - uses pickupStatus='pending' flag instead of clearing inspection
- [x] Redesigned vehicle card: danger zone section with divider, label, and hint text separates it from inspection button
- [x] Added pickupStatus field to Vehicle type in data.ts

## Bug Fix - Pickup Badge & Mark as Picked Up (Feb 23)
- [x] Pickup badge now only shows when load status is picked_up (uses showPickupBadge = hasPickupInspection && loadStatus === 'picked_up')
- [x] Mark as Picked Up root cause: handlePickReceipt used await new Promise(Alert) which blocks iOS Alert queue
- [x] Fix: replaced await-Promise-Alert pattern with direct callback approach (launchReceiptCamera / launchReceiptLibrary)
- [x] All 82 tests pass, 0 TypeScript errors

## Bug Fix - Modal Overlay Intercepting CTA Button (Feb 23)
- [x] InfoRow maps picker Modal uses full-screen TouchableOpacity overlay that stays mounted and intercepts touches
- [x] Fix: wrap Modal in {showMapsPicker && <Modal ...>} so it is completely unmounted when not visible (no invisible overlay)
- [x] Both navigable InfoRow instances (pickup address + delivery address) fixed
- [x] 81 tests pass, 0 TypeScript errors

## Move Back to Pending — Fix (Feb 23)
- [x] Show "Move Back to Pending" button on ALL vehicles when load status is picked_up (not just ones with inspection photos)
- [x] After confirming "Move Back to Pending", close the load detail screen and return to loads list (vehicle should appear in Pending tab)
- [x] revertVehicleToPickupPending now sets load status back to "new" so it appears in Pending tab
- [x] Hint text is context-aware: shows "Inspection photos & data will be kept" if inspected, else "Load will move back to Pending tab"

## Delivery Inspection Flow — Mirror Pickup (Feb 23)
- [x] Delivery inspection: camera → damage diagram → additional inspection fields → load detail (same as pickup)
- [x] Remove auto-mark-delivered after saving delivery inspection (saveDeliveryInspection no longer changes load status)
- [x] "Mark as Delivered" button at bottom of load detail (manual, like "Mark as Picked Up")
- [x] Delivery inspection screen detects delivery via load.status === 'picked_up' and saves to deliveryInspection
- [x] After delivery inspection saved, driver reviews load detail then manually taps "Mark as Delivered"
- [x] After "Mark as Delivered" confirmed, router.back() closes screen and returns to loads list
- [x] CTA button label simplified to always say "Mark as Delivered" (alert handles gate when inspection not done)

## Remove Mandatory Delivery Inspection Gate (Feb 23)
- [x] Remove the "Inspection Required" alert that blocks "Mark as Delivered" when delivery photos not taken
- [x] Delivery inspection is optional — driver can mark delivered at any time

## Restore Stats Bar on Loads Screen (Feb 23)
- [x] Restore stats bar below tab selector showing: unique pickup spots, unique drop-off spots, total vehicles
- [x] Stats bar shows for all tabs (Pending, Picked Up, Delivered, Archived) when tab has loads
- [x] Stats bar hidden when tab is empty (no loads)

## Map Features
- [x] Tappable Pickup Spots badge opens map with all pickup locations pinned
- [x] Tappable Drop-off Spots badge opens map with all dropoff locations pinned
- [x] LocationsMapModal component with auto-fit region, numbered pins, and location list
- [x] Map modal pins show vehicle info (year/make/model) instead of load number
- [x] Map modal pin sublabel shows facility/company name instead of city/state
- [x] Map modal: toggle between pickup and dropoff pin layers
- [x] Map modal: tap a vehicle in list to highlight its paired pickup/dropoff pin
- [x] Map modal: paired pins use vehicleId to link pickup ↔ dropoff across loads

## Mandatory-Photo Pickup Flow (Feb 23)
- [x] Add markAsPickedUp method to company-platform-client.ts (loadNumber, legId, driverCode, pickupTime, pickupGPS, pickupPhotos)
- [x] Add loads.markAsPickedUp tRPC procedure to server/routers.ts
- [x] Add pickupConfirm flag to cameraSessionStore meta type
- [x] "Mark as Picked Up" button navigates to camera → inspection screen (photos mandatory)
- [x] Inspection screen detects pickupConfirm mode from cameraSessionStore meta
- [x] "Complete Pickup" button shown only in pickupConfirm mode
- [x] "Complete Pickup" disabled until at least 1 inspection photo is taken
- [x] Warning banner shown when no photos taken in pickupConfirm mode
- [x] On Complete Pickup: save inspection locally → capture GPS → upload photos to S3 → call markAsPickedUp → navigate to loads list
- [x] "Save & Come Back Later" secondary button available in pickupConfirm mode
- [x] 0 TypeScript errors after all changes

## Mark as Picked Up Flow Fix (Feb 23)
- [x] "Mark as Picked Up" checks if any pickup photos exist for the load
- [x] If NO photos: show alert "Missing pickup pictures — take them now?" YES→camera/inspection, NO→stay on load detail
- [x] If YES photos (≥1): mark load as picked up immediately, call platform API, navigate to loads list
- [x] Remove the old camera-auto-open behavior (no longer auto-launches camera on button tap)
- [x] Inspection screen "Complete Pickup" button still works for the YES→camera path

## Platform Status Sync Bug — Mark as Picked Up (Feb 23)
- [x] Trace markAsPickedUp call: server router → company-platform-client → platform API endpoint
- [x] Check server logs for errors when markAsPickedUp is called
- [x] Probe company platform API to find the correct endpoint/payload for updating trip status to picked_up
- [x] Fix the root cause: wrong field names (loadNumber→loadId, pickupGPS→gpsLatitude/gpsLongitude, pickupPhotos→photos) + platform removed redundant loads:write permission check
- [x] Verify platform returns HTTP 200 with status: picked_up after fix

## Revert Picked Up → Pending Platform Sync (Feb 23)
- [x] Find the revert-to-pending action in the load detail screen
- [x] Discover correct platform endpoint for reverting picked_up → assigned (added revertPickup endpoint to platform)
- [x] Add platform revert call when driver moves vehicle back to pending
- [x] Verify platform returns HTTP 200 with status: assigned after revert

## markAsPickedUp Still Not Syncing to Platform (Feb 23 — Round 2)
- [x] Check server logs: error was "Load leg not found or not assigned to this driver" (403 FORBIDDEN)
- [x] Root cause: app was parsing platformTripId from stale load.id string (old legId 420001) instead of reading load.platformTripId (fresh legId 450002/450003)
- [x] Fix: read load.platformTripId directly; added platformTripId as typed field on Load interface; bumped cache key to v6 to force fresh fetch

## markAsPickedUp Platform Sync — Round 3 (Feb 23)
- [ ] Check live server logs for the exact error on markAsPickedUp
- [ ] Probe platform with actual legIds from current assigned loads
- [ ] Add visible error toast in app so driver sees sync failures
- [ ] Fix root cause permanently

## Single Driver ID System (Feb 23)
- [x] Store platform-returned driverId as platformDriverCode at registration
- [x] Use platformDriverCode (not local driverCode) for all platform API calls
- [x] Fix markAsPickedUp, revertPickup, markAsDelivered to use platformDriverCode
- [x] Fall back to local driverCode only if platformDriverCode is not yet set
- [x] Auto-upgrade stored session on app start if platformDriverCode is missing (handles existing sessions)

## Mark as Delivered Platform Sync Bug (Feb 23)
- [ ] Fix handleMarkDelivered to use platformDriverCode (not local driverCode)
- [ ] Fix handleMarkDelivered to use load.platformTripId (not stale legId from load.id)
- [ ] Verify platform shows Delivered after driver marks as delivered

## Mark as Delivered Platform Sync Fix (Feb 23)
- [x] Root cause: app was calling old updateTripStatus endpoint (403 FORBIDDEN) instead of markAsDelivered
- [x] Added markAsDelivered method to company-platform-client.ts with correct field mapping (loadNumber→loadId, deliveryGPS→gpsLatitude/gpsLongitude, deliveryPhotos→photos)
- [x] Added markAsDelivered tRPC procedure to server/routers.ts
- [x] Updated load detail screen handleMarkDelivered to use markAsDeliveredMutation
- [x] Verified platform returns HTTP 200 with status: delivered

## Push Notifications — End-to-End Implementation

- [x] Register push token on login (not just on Profile tab visit)
- [x] Save push token to driver app server DB immediately after login
- [x] Add registerPushToken endpoint to company platform (stores driver push token)
- [x] Driver app sends push token to platform on login
- [x] Add POST /api/webhooks/load-assigned endpoint on driver app server
- [x] Platform calls driver app webhook when a load is assigned to a driver
- [x] Driver app server looks up driver push token and sends Expo push notification
- [x] Notification shows load number, vehicle, and route info
- [x] Tapping notification opens the load detail screen

## Push Token Universal Fix (All Auth Methods)
- [x] Audit: confirm drivers.updateProfile uses protectedProcedure (session-gated) — blocks phone-auth users
- [x] Fix: switch push token save in loginWithPhone to use public savePushTokenToPlatform endpoint (driverCode-keyed, no session required)
- [x] Fix: push token save now works for ALL auth methods (phone OTP, email, demo) via single universal helper
- [x] Fix: on app resume/foreground (AppState change), re-register push token for existing sessions
- [x] Fix: on app open with existing session, call registerForPushNotificationsAsync and save token if missing or changed
- [x] Fix: on logout, clear cached push token so fresh token is saved on next login
- [x] Fix: on login, always clear cached token and re-save fresh (handles reinstalls)
- [x] Verify: push token forwarded to company platform for all auth methods via savePushTokenToPlatform
- [x] Test: all 86 tests pass, 0 TypeScript errors

## Webhook Wiring — Company Platform Load Assignment
- [ ] Read company platform load assignment router to find the assign-driver mutation
- [ ] Add notifyDriverApp() helper to platform that calls POST /api/webhooks/load-assigned on driver app server
- [ ] Call notifyDriverApp() after successful driver assignment in the platform router
- [ ] Store DRIVER_APP_WEBHOOK_URL and DRIVER_APP_WEBHOOK_SECRET as env vars on the platform
- [ ] Test: assign a load on the platform and verify the driver app webhook fires
- [ ] Handle errors gracefully — webhook failure must never block the assignment from saving

## Bug: Assigned loads not showing in driver app
- [ ] Audit loads.getAssigned router — check driverCode used to query platform
- [ ] Check company-platform-client.getAssignedLoads — verify request format and response parsing
- [ ] Test live platform API call with driver's platformDriverCode
- [ ] Fix root cause and verify loads appear

## Bug: Platform status not synced back to app on fetch
- [x] Root cause: platform getAssignedLoads only filtered for 'assigned' status, excluding 'picked_up'
- [x] Fix applied on platform: query now includes both 'assigned' and 'picked_up' statuses
- [x] Driver app cache key bumped (v7) to clear stale status data on next app open
- [x] Platform is source of truth — fresh fetch always overwrites local cache

## Vehicle Roster Sheet (Overview Stats)
- [x] Tap "Vehicles" stat on overview opens a bottom sheet
- [x] Bottom sheet lists all vehicles: vehicle description + last 6 of VIN
- [x] Compact single-line rows — scrollable for 10+ vehicles
- [x] Sheet dismisses on tap outside or "Done" button
- [x] "View List ›" hint added to Vehicles stat (mirrors Pickup/Dropoff map hints)

## Bug: Vehicle Roster Sheet — list not rendering
- [x] Root cause: rosterSheet used maxHeight which collapses ScrollView to 0 height on iOS
- [x] Fix: changed to explicit height: "60%" so ScrollView has a defined space to render into
- [x] 0 TypeScript errors

## Tab Count Badges
- [x] Add count badge to Picked Up tab (blue, matching Picked Up status color)
- [x] Pending badge stays orange (warning color), Picked Up badge is blue (primary color)

## Bug: Platform picked_up status not reflected in app tab
- [x] Root cause: staleTime: 30_000 prevented re-fetch for 30s after last fetch, so platform status changes weren't seen
- [x] Fix: staleTime set to 0 so query always re-fetches on focus/mount
- [x] Fix: refetchOnMount: true and refetchOnWindowFocus: true added for immediate sync
- [x] Fix: refetchInterval: 30_000 retained for continuous background polling
- [x] 0 TypeScript errors

## Bug: My Companies section not showing joined company
- [ ] Prairie Auto Transport not appearing in My Companies on Profile tab
- [ ] Trace where company data comes from and fix the display

## UX Improvements
- [x] Remove "are you sure" confirmation alert when marking vehicle as picked up after photos are taken
- [x] Fix: platform status changes (e.g. picked_up reverted to assigned) not reflected in app — platform is now always authoritative on every sync, cache always overwritten with fresh API data
- [x] Redesign Vehicle Condition damage diagram: premium line-art SVG, numbered pins, gradient fills, damage list with pin numbers matching diagram
- [x] Add "No Damage" quick-confirm button to Vehicle Condition diagram — one tap marks vehicle clean, shows green confirmed state, can be undone
- [ ] Move Vehicle Condition damage diagram to a standalone modal — accessible via "Mark Vehicle Damage" button on load detail screen, with damage count badge and Done button
- [x] Move Vehicle Condition damage diagram to a standalone modal — accessible via "Mark Vehicle Damage" button on load detail screen, with damage count badge and Done button
- [ ] Burn timestamp + GPS location watermark onto every inspection photo (SuperDispatch-style tamper-evident overlay)
- [x] Update photo watermark: reverse geocode GPS to city/address (SuperDispatch style) instead of raw coordinates
- [x] Upload photos only on Save (not on capture) — deleted photos are never uploaded, upload runs in background after Save
- [x] Background upload retry: photos keep uploading after Save and after pickup — persistent retry loop until all photos are fully uploaded, with pending indicator on load cards
- [x] Fix Pickup Spots / Drop-off Spots map view — geocode platform load addresses using Nominatim so map pins show correct locations instead of empty map
- [x] Fix Drop-off Spots map pin — delivery address geocoding not producing coordinates (pickup works, delivery still missing)
- [x] Replace Pickup Spots / Drop-off Spots / Vehicles stats row with: vehicles delivered this month, this year, and all time
- [x] Swipe left/right gesture to navigate between Pending, Picked Up, Delivered, Archived tabs on loads screen
- [x] Animated slide transition when swiping between tabs (content slides from swipe direction)
- [x] One-time swipe hint animation on first launch of loads screen
- [x] Revert stats bar to original: Pickup Spots (View Map), Drop-off Spots (View Map), Vehicles (View List)
- [ ] Gate pass: dispatcher can attach a gate pass (PDF/image) to an order via the platform
- [ ] Gate pass: driver can view the gate pass on the load detail screen when one is attached
- [ ] Gate pass: optional — orders without a gate pass show no gate pass section
- [x] Gate pass: database table (gate_pass_files), server tRPC routes (upload/get/delete), driver app viewer modal with image display and PDF open-in-browser fallback, Gate Pass button in load detail header (only visible when a gate pass is attached)
- [x] Gate pass expiry: add optional expiresAt field to gate_pass_files table and upload route
- [x] Gate pass expiry: show warning badge on Gate Pass button when expiry is within 24h or past
- [x] Gate pass expiry: show expiry date and warning text inside the gate pass viewer modal
- [x] Gate pass expiry push notification: server job runs every morning at 7am, finds gate passes expiring that day, sends push notification to the assigned driver
- [x] Gate pass: read gatePassUrl and storageExpiryDate directly from platform load data instead of separate tRPC DB lookup

## Gate Pass Section in Load Detail (Feb 24)
- [x] Show a dedicated Gate Pass section in load detail screen always (not just when gate pass exists)
- [x] When no gate pass: show "No gate pass attached" message with a muted key icon
- [x] When gate pass exists: show Gate Pass button (existing behavior) with expiry warning if applicable

## Gate Pass & Storage Expiry Enhancements (Feb 24)
- [x] Show storage expiry date as a second row in the Gate Pass section when storageExpiryDate is set
- [x] Add key icon badge to load list card when gate pass is attached

## Storage Expiry Pill on Load Cards (Feb 24)
- [x] Add color-coded storage expiry pill to load card: green (3 days), amber (2 days), red (1 day or expired/overdue)

## VIN Scan → Load Match (Feb 24)
- [x] When driver scans a VIN, check all pending loads for last-6 VIN match and navigate to that load's detail screen if found; otherwise continue normal scan flow

## VIN Scan Match Improvements (Feb 24)
- [x] Show match confirmation toast ("Matched to Load #FLT-...") with haptic when VIN scan matches a load
- [x] Expand VIN match scope to include picked_up loads (not just new/pending)

## VIN Scan No-Match Toast (Feb 24)
- [x] Show amber "No matching load found — adding as new" toast before navigating to add-load when VIN scan finds no match

## Bug Fix: Gate Pass Not Showing (Feb 24)
- [x] Fix: gatePassUrl and storageExpiryDate were being silently dropped in server/routers.ts loads.getAssigned mapping — now explicitly passed through

## Bug Fix: Gate Pass Viewer Blank Screen (Feb 24)
- [x] Fix gate pass viewer modal to display PDFs and non-image files using WebView — replaced blank modal with WebBrowser.openBrowserAsync (native SFSafariViewController) which handles PDFs, images, and all file types natively

## Load Card Cleanup (Feb 24)
- [x] Remove payment method text (ACH Transfer, Cash on Delivery, etc.) from load card footer row

## Notification Preferences & Storage Expiry Alert (Feb 24)
- [x] Add storage expiry push notification to morning job (fires when storageExpiryDate is today)
- [x] Add notifyGatePassExpiry and notifyStorageExpiry columns to DB schema
- [x] Add Gate Pass Expiring and Storage Expiry Today toggles to NOTIFICATIONS section in Settings
- [x] Respect notifyGatePassExpiry and notifyStorageExpiry preferences in gate-pass-notifier.ts

## Storage Expiry "Days Ago" Text (Feb 24)
- [ ] Load card pill: show "Expired X days ago" instead of "Storage Expired" when storageExpiryDate has passed
- [ ] Load detail row: show "Expired X days ago" instead of "Expired" when storageExpiryDate has passed

## Pickup Signature Flow
- [x] Pickup Signature screen with three paths: customer present, customer not available, skip
- [x] Signature pad using react-native-svg + PanResponder (no extra dependencies)
- [x] Customer signature canvas with live drawing preview and clear button
- [x] Driver signature canvas with live drawing preview and clear button
- [x] Customer Not Available path — driver signature only with amber warning banner
- [x] Review screen showing both signatures before confirming pickup
- [x] Retake option on review screen for both customer and driver signatures
- [x] Mark as Picked Up button on review screen — updates local status + fires platform sync
- [x] Wire into load detail: "Mark as Picked Up" now navigates to signature screen after photos confirmed
- [x] Skip Signature option with destructive confirmation alert

## Signature Storage & Delivery Signature Flow
- [x] Add signature columns to trip_events or create signatures table in DB schema
- [x] Add tRPC route: loads.saveSignature — stores customerSig, driverSig, customerNotAvailable, type (pickup/delivery)
- [x] Update pickup signature screen to call saveSignature on confirm
- [x] Build delivery signature screen at app/delivery-signature/[loadId].tsx (mirrors pickup flow)
- [x] Wire delivery signature screen into Mark as Delivered flow in load detail
- [x] Update markAsDelivered platform sync to include signature data (delivery signature screen handles sync)

## Customer Name on Signature
- [ ] Add customer name text field above signature pad on customer_sig step (pickup + delivery)
- [ ] Save customer name alongside signature in DB

## Driver Signature Auto-Save
- [x] Auto-save driver signature to Settings the first time driver signs on the driver_sig screen (pickup or delivery)
- [x] On subsequent "Customer Not Available" taps, skip driver_sig screen entirely and auto-confirm instantly
- [x] Show info box on first-time driver_sig screen explaining signature will be saved for future use

## Map Geocoding Bug Fix
- [x] Investigate why Canadian addresses (e.g., "Impact IAA Calgary") are not appearing on the map or showing in wrong US locations
- [x] Fix geocoding: replaced AbortSignal.timeout() (not available in React Native) with manual setTimeout + AbortController
- [x] Added countrycodes=ca,us param to Nominatim to prevent wrong-country results
- [x] Bumped geocache key to v2 to force re-geocode of all previously failed addresses

## Map Pin — Show All Vehicles at Location
- [x] Group loads by pickup/delivery location on the map so one pin represents all vehicles at that address
- [x] Tapping a pin shows a scrollable list of all vehicles at that location (not just one)
- [x] Pin badge shows vehicle count; bottom panel shows location list with counts by default

## Map Pin Tap — Expand Vehicle List Fix
- [x] Fix cluster pin tap so it actually expands the vehicle list in the bottom panel (replaced default pin with custom marker + empty Callout to prevent iOS callout interception)
- [x] Show only year/make/model in the expanded vehicle list (no VIN suffix)

## Delivered Loads Disappearing Bug
- [x] Fix: loads marked delivered by driver disappear from app when platform reports "at_terminal" status
- [x] Ensure driver-delivered loads always show in the Delivered tab regardless of platform-side status
- [x] Persist driver's delivered status locally so it survives platform sync overrides (driverDeliveredRef + AsyncStorage snapshots)

## Auto-Archive Delivered Loads
- [x] Auto-archive delivered loads that are older than 30 days (move to "archived" status on app startup)
- [x] Add "Move All Delivered to Archive" button in Profile > LOAD HISTORY section that moves all delivered loads to Archived (not deleted)
- [x] Archived loads remain visible in the Archived tab
- [x] deliveredAt timestamp added to Load type so 30-day age can be calculated

## Search in Delivered & Archived Tabs
- [x] Add single search bar to Delivered and Archived tabs
- [x] Filter loads in real-time by VIN, make, model, or year (any vehicle in the load)
- [x] Clear search button (X) when search has text
- [x] Show "No results" empty state when search returns nothing
- [x] Search clears automatically when switching tabs

## Map Pin Expand Chevron Bug
- [x] Fix: replaced index-based cluster selection with coordinate-key-based selection to prevent mismatch; tapping any location row or pin now reliably expands the vehicle list

## Photo Review on Delivered Loads
- [x] Show pickup photos on load detail screen for delivered/archived loads
- [x] Show delivery photos on load detail screen for delivered/archived loads
- [x] Tappable photo thumbnails that open a full-screen lightbox with page counter

## Drop at Alternate Location Feature
- [x] Add alternateDelivery field to Load data model (location name, address, GPS coords, note, droppedAt)
- [x] Add "Drop at Alternate Location" button on load detail for picked_up loads
- [x] Create alternate delivery screen with known terminals list + custom location + GPS capture
- [x] Allow "Other" option with free-text location name + auto GPS capture
- [x] Optional free-text note for the driver
- [x] Delivery photos remain optional for alternate drops (no photos required)
- [x] Load goes to Delivered status after alternate drop (driver is done)
- [x] Show alternate delivery location banner on load detail after delivery
- [x] Persists through platform sync via markDriverDelivered snapshot

## Alternate Delivery Screen Rework (Feb 25)
- [x] Fetch drop-off locations from company platform API (with load-derived fallback)
- [x] Show only 5 locations at a time ("X more — use search" hint)
- [x] Add search bar to filter locations by name, city, province, or address
- [x] Add "Create New Location" screen with GPS auto-fill (Find My Location + reverse geocode)
- [x] Sync newly created locations back to company platform via tRPC locations.create
- [x] Added getLocations and createLocation to company-platform-client.ts
- [x] Added locations.getAll and locations.create tRPC routes in server/routers.ts

## Alternate Delivery → Platform Sync (Feb 25)
- [x] Add alternateLocationName and alternateLocationNote to MarkAsDeliveredInput interface
- [x] Pass alternate fields in markAsDelivered platform payload (conditionally included)
- [x] Update alternate delivery screen to fire-and-forget markAsDelivered with alternate location fields
- [x] Added alternateLocationName and alternateLocationNote to tRPC markAsDelivered input schema

## Bug: New Location Not Appearing After Creation
- [x] Fix: newly created location in alternate delivery screen doesn't appear in the selection list
- [x] Auto-select the newly created location after saving so driver can immediately confirm the drop
- [x] Ensure selected location always visible in truncated list (prepend if beyond MAX_VISIBLE)
- [x] Clear search query after creation so new location is visible
- [x] Unit tests for location merging, filtering, and create flow

## GPS Proximity Warning on Delivery
- [x] Create Haversine distance utility function (pure math, no dependencies)
- [x] On "Mark as Delivered" tap, compare driver GPS vs assigned destination coordinates
- [x] If distance > 20 miles, show warning alert with 3 options: Mark Delivered Anyway / Drop at Alternate Location / Cancel
- [x] If GPS unavailable or destination not geocoded, skip check and proceed normally
- [x] "Drop at Alternate Location" option navigates to alternate delivery screen
- [x] Unit tests for Haversine distance function (10 tests passing)

## Recently Used Alternate Locations
- [x] Persist last 3 alternate drop locations to AsyncStorage
- [x] Show "Recently Used" section at top of alternate delivery location list
- [x] Update recently used list when driver confirms an alternate drop
- [x] Recently used locations appear above the regular location list with a label

## Alternate Drop Badge on Delivered Load Cards
- [x] Show small "ALT DROP" badge on load cards in Delivered/Archived tabs when load has alternateDelivery
- [x] Badge shows alternate location name
- [x] Visually distinct from normal delivered cards (e.g., orange accent)

## Navigate to Location Button
- [x] Add "Get Directions" button on alternate delivery screen for selected location
- [x] Opens Apple Maps (iOS) or Google Maps (Android/web) with turn-by-turn navigation
- [x] Only shown when selected location has GPS coordinates

## Delete Non-Platform Loads
- [x] Add deleteLoad(loadId) function to loads context (removes from localLoads + deliveredSnapshots + AsyncStorage)
- [x] Add clearNonPlatformLoads() function to loads context
- [x] Swipe-to-delete gesture on load cards for non-platform loads (load-* and L00x IDs)
- [x] Platform loads (platform-*) show no delete option — fully protected
- [x] Confirmation alert before deleting a load
- [x] "Clear test data" button in Profile/Settings screen to wipe all demo/mock loads in one tap
- [x] Clear Test Data button only visible when non-platform loads exist (auto-hides after clearing)

## Vehicle Inspection Review Screen
- [x] Create inspection review screen showing vehicle info header (year/make/model, type, VIN)
- [x] Photo gallery with large main image and scrollable thumbnail strip below
- [x] Photo counter badge (e.g., "6/7") on main image
- [x] Tap thumbnail to switch main image, swipe main image to navigate
- [x] "Take Photo" button to add more inspection photos
- [x] Damages section showing marked damages or "No Damages" placeholder
- [x] "Mark Damage" button navigates to full inspection editor
- [x] Caption/metadata below main image (e.g., "Pickup Condition: date, location")
- [x] Navigate to inspection review from load detail screen (View Pickup/Delivery Inspection)
- [x] Support both pickup and delivery inspection types
- [x] Additional Inspection section (odometer, drivable, keys, etc.)
- [x] Notes section when inspection has notes
- [x] Edit pencil icon in header to jump to full inspection editor
- [x] Unit tests (13 passing)

## Conditional Storage Expiry Display
- [x] Only show storage expiry when a gate pass is attached to the load (load detail screen)
- [x] Only show storage expiry badge on load cards when gate pass is attached
- [x] If no gate pass attached, hide the expiry section entirely

## Fix Inspection Review Location Caption
- [x] Caption shows load's pickup/delivery contact address instead of driver's actual GPS location
- [x] Store driver's GPS location on inspection save (lat/lng on VehicleInspection)
- [x] Reverse-geocode driver's GPS to get actual city/province for the caption
- [x] Fall back to load contact address if GPS is unavailable
- [x] Added locationLat, locationLng, locationLabel fields to VehicleInspection type
- [x] Updated both handleSave and handleCompletePickup to capture GPS + reverse-geocode

## Replace Vehicle Damage Diagram with Professional Drawing
- [x] Replace basic SVG vehicle diagram with professional technical line-drawing
- [x] Include top-down view and side view (similar to Super Dispatch style)
- [x] Clean detailed line art with proper car proportions, wheels, panels, doors, mirrors
- [x] Created shared VehicleDiagramSvg component used by both inspection screen and damage modal
- [x] White background with dark stroke lines for clean technical drawing look
- [x] Maintain all existing damage zone tap targets
- [x] Ensure damage markers still appear correctly on the new diagram (overlay SVG layer)

## Replace SVG Diagram with User-Provided Vehicle Image
- [x] Copy user's vehicle diagram image into project assets (assets/images/vehicle-diagram.png)
- [x] Replace VehicleDiagramSvg component with Image-based VehicleDiagramImage in inspection screen
- [x] Replace VehicleDiagramSvg component with Image-based VehicleDiagramImage in damage modal
- [x] Keep damage pin overlay working on top of the image
- [x] Both top-down and side views shown in a single image (no view toggle needed)
- [x] Removed top/side toggle — tap position determines zone (top half = top view, bottom half = side view)
- [x] Cleaned up unused SVG imports in both files

## Per-Damage Photo Capture
- [x] Add photos[] array to VehicleDamage type (each damage pin can have its own photos)
- [x] Add "Add Photos" section to the Mark Damage bottom sheet (camera + library)
- [x] Show photo thumbnails inside the damage sheet before confirming
- [x] Damage photos get added to the vehicle inspection photo gallery automatically
- [x] Damage photos are also stored on the damage entry itself (linked to the pin)
- [x] Tapping an existing damage pin on the diagram shows its photos in a viewer
- [x] Damage pin viewer shows damage type, severity, notes, and linked photos
- [x] Blue dot indicator on damage pins that have photos (visible on diagram overlay)
- [x] Damage list below diagram showing all damage entries with photo count badges
- [x] Vehicle Condition diagram rendered in inspection screen JSX (was missing from JSX)

## Inline Damage Diagram on Inspection Screen (Feb 25)
- [x] Move damage diagram inline on the inspection screen (between photos and notes)
- [x] Remove any separate navigation to a damage screen — all in one scrollable flow
- [x] Diagram shows "VEHICLE CONDITION" section header with damage count badge
- [x] Tapping diagram opens DamageModal bottom sheet to add damage (already works)
- [x] Damage list appears directly below the diagram
- [x] Full inspection flow: Photos → Damage Diagram → Notes → Odometer → Additional Inspection → Save

## Damage Diagram on Inspection Review Screen (Feb 25)
- [x] Add VehicleDiagram inline to the Vehicle Inspection review screen (between Damages list and Additional Inspection)
- [x] Diagram is interactive — driver can still tap to add new damage or tap existing pin to view/delete
- [x] Damage list and diagram stay in sync on the review screen
- [x] DamageModal bottom sheet wired up on review screen (same as inspection screen)
- [x] Changes auto-save to inspection record immediately (no separate Save button needed)

## Bug: Damage Pin Positioning Incorrect (Feb 25)
- [x] Pins not appearing on correct vehicle parts (e.g., Hood pin on fender, Wheel pins at bottom edge)
- [x] Fix inferZone coordinate mapping to match actual vehicle diagram image layout
- [x] Image analyzed with pixel-level precision: 3 sections identified (top-down 0-33%, side 33-68%, bottom 68-100%)
- [x] inferZoneTop rewritten with normalized relY coordinates within top-down section
- [x] inferZoneSide rewritten with normalized relY coordinates within side section
- [x] inferZoneBottom added for the bottom mirror view (y 68-100%)
- [x] handleTap updated to use 3-way section split instead of 2-way
- [x] Both inspection screen and review screen updated with same fix

## Remove Mark Vehicle Damage from Load Details (Feb 25)
- [x] Remove "Mark Vehicle Damage" button from load details screen
- [x] Removed VehicleDamageModal import and showDamageModal state (no longer needed)
- [x] Damage count badge on vehicle card kept (still useful to show at a glance)
- [x] Damage marking now exclusively accessed via View Pickup/Delivery Inspection screens

## Always Show View Inspection Buttons (Feb 25)
- [x] Show "View Pickup Inspection" button whenever a pickup inspection record exists (not just when photos > 0)
- [x] Show "View Delivery Inspection" button whenever a delivery inspection record exists (not just when photos > 0)
- [x] Photo count shown in label only when photos exist (e.g. "View Pickup Inspection (3 photos)")

## Alternate Drop Location — Full Address Fields (Feb 25)
- [x] Alternate drop location form already has address, city, province fields in Create New Location mode
- [x] createLocationMutation already sends these fields to the platform when creating a new location
- [x] Added alternateLocationAddress, alternateLocationCity, alternateLocationProvince, alternateLocationPostalCode to markAsDelivered server schema
- [x] Added these fields to MarkAsDeliveredInput interface in company-platform-client.ts
- [x] Forwarded these fields in the platform API payload in markAsDelivered function
- [x] handleConfirm now passes selectedLocation.address, city, province to markAsDeliveredMutation
- [x] "Find My Location" button already exists to auto-populate address fields via GPS reverse geocode

## Skip Pickup Signature Screen by Default (Feb 26)
- [x] Default behavior: tapping "Mark as Picked Up" auto-uses "Customer Not Available" (saved driver signature) — no signature screen shown
- [x] Added "Require customer signature" toggle row above the Mark as Picked Up button
- [x] Toggle shows hint: OFF = "Will auto-confirm as customer not available", ON = "Signature screen will appear"
- [x] If toggle is ON, navigates to the Pickup Signature screen as before
- [x] If toggle is OFF (default), auto-confirms with customerNotAvailable=true, saves signature record, syncs to platform
- [x] Toggle resets to OFF after pickup is confirmed (per-session state)

## Skip Delivery Signature Screen by Default + Toast Confirmation (Feb 26)
- [x] Add "Require customer signature" toggle above "Mark as Delivered" button (same pattern as pickup)
- [x] Default: auto-confirm delivery with customerNotAvailable=true using saved driver signature
- [x] If toggle ON, show the Delivery Signature screen as before
- [x] Added Animated toast overlay to load details screen
- [x] Toast shows "Pickup confirmed — Customer not available" after auto-pickup
- [x] Toast shows "Delivery confirmed — Customer not available" after auto-delivery
- [x] Toast fades in (200ms), holds 2s, fades out (300ms) — non-blocking, pointerEvents=none

## Optional Pickup Photos — Skip Without Blocking (Feb 26)
- [x] Renamed "Not Now" to "Skip Photos" (red/destructive) on the first alert
- [x] "Skip Photos" shows a second confirmation: "Proceed Without Photos?" with risk warning text
- [x] "Proceed Without Photos" continues with the full pickup flow (respects requireCustomerSignature toggle)
- [x] Toast shows "Pickup confirmed — No photos taken" so driver knows it went through
- [x] "Take Photos" button still works as before
- [x] TypeScript: 0 errors

## Lock Pickup Inspection After Pickup (Feb 26)
- [x] Pickup inspection photos and damage marks are read-only once vehicle is marked as picked up
- [x] Inspection review screen shows "Locked" banner when viewing a picked-up vehicle's pickup inspection
- [x] Remove Add Photo / Take Photo buttons on pickup inspection review when locked
- [x] Remove damage diagram tap-to-add and delete buttons on pickup inspection review when locked
- [x] Delivery inspection remains fully editable until delivery is confirmed
- [x] Delivery inspection also locks after delivery is confirmed
- [x] Active inspection screen redirects to review screen if inspection is locked (prevents editing via direct URL)

## Pickup Confirmation Feedback (Feb 26)
- [x] Toast at bottom: "Vehicle picked up — moved to Picked Up tab" after successful pickup
- [x] Pulse/scale animation on the Picked Up tab pill to guide driver's eye
- [x] Auto-switches to Picked Up tab on return to loads screen
- [x] Success haptic fires on pickup confirmation

## Universal Status-Change Feedback (Feb 26)
- [x] Generalize highlight store to support any destination tab (new, picked_up, delivered, archived)
- [x] Delivery confirmation: toast + auto-switch to Delivered tab + pulse Delivered tab pill
- [x] Revert to Picked Up: toast + auto-switch to Picked Up tab + pulse Picked Up tab pill
- [x] Revert to Pending: toast + auto-switch to Pending tab + pulse Pending tab pill
- [x] Loads index: pulse animation works for all four tabs, not just Picked Up
- [x] Toast displayed on the loads index screen (not just the load detail screen) after status change

## Bug: Assigned load not appearing in driver app (Feb 26)
- [ ] Investigate why "Assigned" status load assigned to "Test Driver" is not showing in Pending tab
- [ ] Fix driver name matching / driver code matching logic if that is the cause

## UX: Remove Skip-Photos Warning Dialog (Feb 26)
- [x] Remove "Proceed Without Photos?" Alert.alert confirmation — skip photos should proceed immediately

## Bug: Alternate Drop Status Not Updating on Company Platform (Feb 26)
- [x] Vehicle stays "Picked Up" on company platform after alternate drop confirmed on driver app
- [x] Trace full alternate drop flow: UI → tRPC router → company-platform-client → platform API
- [x] Added at_terminal → delivered status mapping in driver app so terminal drops show correctly
- [x] Improved server log to show isAlternateDrop and alternateLocationName for easier debugging
- [ ] Company platform: markAsDelivered handler must set status to at_terminal when alternateLocationName is present (company platform fix required)

## Bug: Delivery Signature Forced Even When Toggle is OFF (Feb 26)
- [x] Mark as Delivered forces signature screen even when "Require Customer Signature" toggle is OFF
- [x] Root cause: GPS far-from-destination path always routed to signature screen regardless of toggle
- [x] Fixed: "Mark Delivered Anyway" now respects the requireDeliverySignature toggle — auto-confirms when OFF
- [x] Leg 3 loads worked because they had no delivery coordinates, skipping the GPS check entirely

## Remove Alternate Drop-Off Feature (Feb 26)
- [x] Delete alternate-delivery screen (app/alternate-delivery/[loadId].tsx)
- [x] Remove "Drop at Alternate Location" button from load detail screen
- [x] Remove "Drop at Alternate Location" option from GPS proximity warning alert
- [x] Remove alternate delivery banner from load detail screen
- [x] Remove alternate drop badge from loads index screen
- [x] Remove alternate location fields from server/company-platform-client markAsDelivered
- [x] Remove setAlternateDelivery from loads-context (interface + implementation + provider value)
- [x] Remove AlternateDelivery interface and alternateDelivery field from Load type in data.ts
- [x] Remove at_terminal status mapping (was only used for alternate drops)
- [x] Clean up unused styles (altDropBanner)

## Migrate to driversApi.syncInspection (Feb 27)
- [x] Update company-platform-client: replace submitInspectionReport with syncInspection (new payload with loadNumber, legId, x/y damages, noDamage, gps, timestamp)
- [x] Update server router: replace submitInspection with syncInspection using new Zod schema
- [x] Update inspection screen: send full payload (loadNumber, legId, x/y damages, noDamage, gps, timestamp) to new endpoint
- [x] Verify TypeScript compiles with 0 errors

## Bug: syncInspection sends empty photos array (Feb 27)
- [x] Race condition: S3 photo uploads run in background but syncInspection fires before uploads complete
- [x] Fix: added PhotoQueue.flushAndGetUrls() that awaits all pending uploads and returns S3 URLs
- [x] handleSave now awaits flushAndGetUrls() before calling syncInspection — photos array guaranteed populated
- [x] Deduplication: uses Set to merge existing S3 URLs with newly uploaded ones
- [x] GPS coordinates: handleSave now passes real locationLat/locationLng to syncInspection (was hardcoded 0,0)
- [x] Graceful fallback: if flush fails, falls back to fire-and-forget so background loop retries
- [x] Fixed pre-existing test: MAX_RETRIES was changed to 10 but test still used attempts: 2
- [x] Added 5 unit tests for flushAndGetUrls (success, already-uploaded, failed, vehicle isolation, offline)

## Bug: Inspection photos uploaded in low quality (Feb 27)
- [x] Identified all photo quality/compression settings across the codebase
- [x] camera-session.tsx: raised takePictureAsync quality 0.85 → 1.0 (no compression), enabled exif:true
- [x] photo-session-modal.tsx: raised takePictureAsync quality 0.85 → 1.0, enabled exif:true
- [x] inspection/[vehicleId].tsx: raised all ImagePicker quality 0.85 → 1.0 (library + camera)
- [x] inspection-review/[vehicleId].tsx: raised all ImagePicker quality 0.85 → 1.0
- [x] vehicle-inspection-modal.tsx: raised ImagePicker quality 0.85 → 1.0
- [x] stamp-renderer.tsx: raised ViewShot quality 0.88 → 1.0 (no JPEG compression on stamp output)
- [x] stamp-renderer.tsx: fixed render dimensions from screen width (~390px) to 3024×4032 (full 12MP resolution) — this was the biggest quality loss
- [x] stamp-renderer.tsx: scaled stamp banner/text proportionally to the new high-res render size
- [x] Server upload endpoint: confirmed no server-side resizing or recompression (passes buffer directly to S3)

## Bug: Vehicle damage diagram tap zones map to wrong parts (Feb 27)
- [x] Read vehicle-diagram-svg.tsx and vehicle-diagram.png to understand actual layout
- [x] Identified 3 diagram sections: top-down (0-38%), body/roof (38-65%), side profile (65-100%)
- [x] Fixed section boundaries in handleTap: was 33/68, corrected to 38/65
- [x] Rewrote inferZoneTop: front at top, hood=upper half, trunk=lower half, wheels at corners
- [x] Rewrote inferZoneSide (body view): door panels on far left/right, roof in centre
- [x] Rewrote inferZoneBottom (side view): front=left, rear=right, windshield/hood front-left, trunk rear-right, doors centre

## Bug: Vehicle diagram zones still incorrect after first fix (Feb 27)
- [x] Rewrite inferZoneTop: top section has REAR at top, FRONT at bottom — trunk=upper half, hood=lower half, rear wheels at top corners, front wheels at bottom corners
- [x] Rewrite inferZoneSide (body view): Trunk=far left panel, Rear Windshield=left-centre, Roof=centre, Windshield=right-centre, Hood=far right
- [x] Rewrite inferZoneBottom (side view): front=left, rear=right, windshield upper-front, rear windshield upper-rear, doors centre
- [x] Add rear_windshield to DamageZone type in data.ts
- [x] Add rear_windshield to DAMAGE_ZONES display list with label "Rear Windshield"

## Bug: Vehicle diagram zones still wrong - v3 fix from color-annotated image (Feb 27)
- [x] Fix body/roof section: far right separate panel (pink) = Front Bumper, Hood = red zone before it
- [x] Fix body/roof section x% boundaries: Trunk<10, RearWindshield<35, Roof<58, Windshield<75, Hood<88, FrontBumper>88
- [x] Fix top-down section: FRONT at top (front wheels at top corners), REAR at bottom, Hood=upper half, Trunk=lower half
- [x] Side view unchanged: front=left, rear=right, doors=centre

## Feature: Full zone remap v4 from fully annotated diagram (Feb 27)
- [x] Added new DamageZone types: fl_fender, fr_fender, fl_door, rl_door, fr_door, rr_door, rl_panel, rr_panel, fl_bumper, rf_bumper
- [x] Rewrote inferZoneTop: F.L Wheel top-right, R.L Wheel top-left, F.L Bumper top-right strip, F.L Fender, F.L Door, R.L Door, R.L Panel, Hood/Trunk centre
- [x] inferZoneSide (body/roof): unchanged from v3 (Trunk|RearWindshield|Roof|Windshield|Hood|FrontBumper)
- [x] Rewrote inferZoneBottom: R.R Panel far-left, R.R Door, F.R Door, F.R Fender, R.F Bumper far-right, R.R Wheel bottom-left, F.R Wheel bottom-right
- [x] Updated DAMAGE_ZONES display list with all new zone labels and positions

## Bug: Top-down section zones wrong - v5 fix (Feb 27)
- [x] Fixed inferZoneTop: LEFT=rear (R.L Bumper, R.L Wheel, R.L Panel, R.L Door), RIGHT=front (F.L Door, F.L Fender, F.L Wheel, F.L Bumper), centre=Hood(right)/Trunk(left)
- [x] Added rl_bumper to DamageZone type and DAMAGE_ZONES display list

## Bug: Side view zones wrong - v6 fix (Feb 27)
- [x] Fixed inferZoneBottom: REAR on LEFT, FRONT on RIGHT
- [x] R.R Bumper=far left, R.R Panel=left body, R.R Wheel=bottom-left, R.R Door=left-centre, F.R Door=centre, F.R Fender=right body, F.R Wheel=bottom-right, R.F Bumper=far right
- [x] Added rr_bumper to DamageZone type and DAMAGE_ZONES display list

## Bug: GPS/timestamp stamp not appearing on uploaded photos (Feb 28)
- [ ] Trace stamp rendering flow - why is stamp not burned onto photos before S3 upload
- [ ] Fix stamp rendering to ensure it fires before upload

## Bug: GPS/timestamp stamp not appearing on uploaded photos (Feb 28)
- [x] Root cause: ViewShot offscreen component at left:-9999 cannot render at 3024px — device screen is only ~390px wide
- [x] Fix: replaced ViewShot with server-side Sharp compositing via new photos.stampPhoto tRPC endpoint
- [x] Added server/photo-stamp-server.ts using Sharp to burn SVG banner onto photo at full resolution
- [x] Added lib/stamp-photo-client.ts that reads photo as base64, calls server, saves stamped image locally
- [x] camera-session.tsx now calls stampPhotoViaServer() before enqueue — stamp is burned before upload
- [x] Graceful fallback: if server stamp fails, original photo is used so inspection is never blocked
- [x] TypeScript: 0 errors
