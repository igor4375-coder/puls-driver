#!/usr/bin/env bash
# Register a driver's iPhone UDID for internal (ad hoc) installs, rebuild, and print install steps.
#
# Usage:
#   ./scripts/onboard-ios-driver.sh 00008110-000228891431401E "David Pauls"
#
# Requires: Expo login (igor4375) + Apple Developer login in the interactive device:create step.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../" && pwd)"
UDID="${1:?Usage: $0 <UDID> \"Driver Name\"}"
NAME="${2:?Usage: $0 <UDID> \"Driver Name\"}"

cd "$ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Puls Driver — onboard iOS device (internal / Developer Mode)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Driver: $NAME"
echo "UDID:   $UDID"
echo ""
echo "STEP 1 — Register on EAS (interactive, ~2 min)"
echo "  When prompted:"
echo "    • Account: yes (igor4375)"
echo "    • Apple ID: rico@prairieautotransport.com"
echo "    • Method: Input (type UDID manually)"
echo "    • UDID: $UDID"
echo "    • Name: $NAME"
echo "    • Class: iPhone"
echo ""
read -r -p "Press Enter to open eas device:create..."

npx eas-cli@latest device:create

echo ""
echo "STEP 2 — Rebuild preview IPA (refreshes ad hoc profile with all devices)"
npx eas-cli@latest build --profile preview --platform ios --non-interactive --refresh-ad-hoc-provisioning-profile

echo ""
echo "STEP 3 — Send David the install link"
echo "  When the build finishes, open:"
echo "    https://expo.dev/accounts/igor4375/projects/puls-driver/builds"
echo "  Open the latest preview build → Install / QR on his iPhone."
echo ""
echo "STEP 4 — On David's iPhone (before install)"
echo "  Settings → Privacy & Security → Developer Mode → ON (reboot if asked)"
echo ""
echo "STEP 5 — After install"
echo "  If prompted: Settings → General → VPN & Device Management → Trust developer"
echo "  Open Puls Driver → sign in (Google recommended) → share Driver ID for dispatch invite"
echo ""
