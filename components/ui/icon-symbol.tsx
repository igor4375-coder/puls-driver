// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.left": "chevron-left",
  "chevron.right": "chevron-right",
  "archivebox.fill": "archive",
  "calendar": "calendar-today",
  "map": "map",
  "map.fill": "map",
  "arrow.left": "arrow-back",
  "arrow.right": "arrow-forward",
  "arrow.right.circle.fill": "arrow-forward",
  "xmark": "close",
  "chevron.down": "keyboard-arrow-down",
  // Actions
  "checkmark": "check",
  "checkmark.circle.fill": "check-circle",
  "plus": "add",
  "pencil": "edit",
  "trash.fill": "delete",
  "trash": "delete-outline",
  "doc.text": "description",
  "plus.circle": "add-circle-outline",
  "magnifyingglass": "search",
  "square.and.arrow.up": "share",
  "doc.on.doc": "content-copy",
  "doc.on.doc.fill": "content-copy",
  "printer.fill": "print",
  "paperclip": "attach-file",
  "pencil.and.outline": "draw",
  "photo.on.rectangle": "photo-library",
  // Media
  "camera.fill": "photo-camera",
  "photo.fill": "photo",
  "barcode.viewfinder": "qr-code-scanner",
  // Communication
  "phone.fill": "phone",
  "envelope.fill": "email",
  // Transport
  "car.fill": "directions-car",
  "truck.box.fill": "local-shipping",
  "location.fill": "location-on",
  // UI
  "bell.fill": "notifications",
  "doc.text.fill": "description",
  "gear": "settings",
  "person.fill": "person",
  "clock.fill": "schedule",
  "star.fill": "star",
  "exclamationmark.triangle.fill": "warning",
  // Inspection / Camera
  "checkmark.seal.fill": "verified",
  "xmark.circle.fill": "cancel",
  "bolt.fill": "flash-on",
  "bolt.slash.fill": "flash-off",
  "bolt.badge.a.fill": "flash-auto",
  // Auth
  "eye.fill": "visibility",
  "eye.slash.fill": "visibility-off",
  // Video / Camera extras
  "video.fill": "videocam",
  "bolt.badge.automatic.fill": "flash-auto",
  "location.slash.fill": "location-off",
  // Companies
  "building.2.fill": "business",
  "building.2": "business",
  // Notifications
  "bell.badge.fill": "notifications-active",
  "envelope.badge.fill": "mark-email-unread",
  // Equipment
  "wrench.and.screwdriver.fill": "build",
  "list.number": "format-list-numbered",
  "gauge": "speed",
  "chevron.up.chevron.down": "unfold-more",
  "arrow.uturn.left": "undo",
  "key.fill": "vpn-key",
  "calendar.badge.exclamationmark": "event-busy",
  // Navigation / Directions
  "arrow.triangle.turn.up.right.diamond.fill": "directions",
  "clock.arrow.circlepath": "history",
  // Theme
  "moon.fill": "dark-mode",
  "sun.max.fill": "light-mode",
  // Security
  "lock.fill": "lock",
  "lock.open.fill": "lock-open",
  // Dashboard
  "chart.bar.fill": "bar-chart",
  "dollarsign.circle.fill": "monetization-on",
  "shippingbox.fill": "inventory-2",
  "road.lanes": "timeline",
  "gauge.with.needle.fill": "speed",
  "trophy.fill": "emoji-events",
  "target": "gps-fixed",
  "tray": "inbox",
  "chevron.up": "keyboard-arrow-up",
  "arrow.up.right": "trending-up",
  "arrow.down.right": "trending-down",
  // Misc missing
  "arrow.clockwise": "refresh",
  "arrow.triangle.branch": "call-split",
  "arrow.up.arrow.down": "swap-vert",
  "info.circle.fill": "info",
  "eraser.fill": "backspace",
  "location.slash": "location-off",
  "mappin.and.ellipse": "pin-drop",
  "pencil.circle.fill": "edit",
  "arrow.up.circle.fill": "arrow-upward",
  "arrow.down.circle.fill": "arrow-downward",
  "arrow.up": "arrow-upward",
  "arrow.down": "arrow-downward",
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
