/**
 * Push Notification Service
 * Handles device token registration and notification tap routing.
 * Works on iOS and Android (physical devices only — not simulators).
 * Push notifications require a development build; local notifications work in Expo Go.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { router } from "expo-router";

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register for push notifications and return the Expo push token.
 * Returns null on simulators/web or if permission is denied.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) {
    console.log("[Push] Skipping registration — not a physical device");
    return null;
  }

  // Android channel setup
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "AutoHaul",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0a7ea4",
    });
    await Notifications.setNotificationChannelAsync("invites", {
      name: "Company Invites",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync("loads", {
      name: "Load Assignments",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 200, 300],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[Push] Permission denied");
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log("[Push] Token registered:", tokenData.data);
    return tokenData.data;
  } catch (err) {
    console.error("[Push] Failed to get token:", err);
    return null;
  }
}

/**
 * Set up a listener that routes notification taps to the correct screen.
 * Call this once in the root layout.
 */
export function setupNotificationResponseListener(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    const type = data?.type as string | undefined;

    if (type === "invite") {
      // Navigate to profile tab where pending invites are shown
      router.push("/(tabs)/profile");
    } else if (type === "load_assigned") {
      const loadId = data?.loadId as string | undefined;
      if (loadId) {
        router.push("/(tabs)" as any);
      } else {
        router.push("/(tabs)");
      }
    }
  });

  return () => subscription.remove();
}

/**
 * Send a local notification (for testing or in-app alerts).
 * Works in Expo Go on iOS.
 */
export async function sendLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {} },
    trigger: null, // immediate
  });
}
