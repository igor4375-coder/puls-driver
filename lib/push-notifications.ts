/**
 * Push Notification Service
 * Handles device token registration, notification tap routing, and
 * automatic responses to dispatcher location requests.
 * Works on iOS and Android (physical devices only — not simulators).
 * Push notifications require a development build; local notifications work in Expo Go.
 */
import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { router } from "expo-router";
import { sendImmediateLocationPing } from "@/lib/location-tracker";

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;

    // Auto-respond to location requests when app is foregrounded
    if (data?.type === "location_request") {
      sendImmediateLocationPing().catch(() => {});
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
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
      name: "Puls Driver",
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
    await Notifications.setNotificationChannelAsync("location-requests", {
      name: "Location Requests",
      description: "Dispatcher requests for your current location",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
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

    // Delay navigation to allow the stack to initialize when app was cold-started from notification
    setTimeout(() => {
      if (type === "invite") {
        router.push("/(tabs)/profile");
      } else if (type === "load_assigned" || type === "load_updated" || type === "load_removed") {
        router.push("/(tabs)");
      } else if (type === "location_request") {
        // Tapped the location request notification — send ping and show confirmation
        sendImmediateLocationPing()
          .then((ok) => {
            if (ok) {
              Alert.alert("Location Shared", "Your current location has been sent to dispatch.");
            } else {
              Alert.alert("Location Unavailable", "Could not get your current location. Make sure location services are enabled.");
            }
          })
          .catch(() => {});
      }
    }, 500);
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
