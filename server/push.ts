/**
 * Expo Push Notification helper for the Puls Dispatch server.
 * Sends push notifications directly to driver devices via the Expo Push API.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

interface ExpoPushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send a push notification to one or more Expo push tokens.
 * Silently ignores invalid/expired tokens — non-critical path.
 */
export async function sendPushNotification(
  tokens: string | string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId?: string
): Promise<void> {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];

  // Filter to valid Expo push tokens only
  const validTokens = tokenList.filter(
    (t) => typeof t === "string" && t.startsWith("ExponentPushToken[")
  );

  if (validTokens.length === 0) {
    console.log("[Push] No valid Expo push tokens — skipping notification");
    return;
  }

  const messages: ExpoPushMessage[] = validTokens.map((token) => ({
    to: token,
    title,
    body,
    data: data ?? {},
    sound: "default",
    priority: "high",
    channelId: channelId ?? "default",
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.warn(`[Push] Expo API error: ${response.status} ${response.statusText}`);
      return;
    }

    const result = await response.json() as { data: ExpoPushTicket[] };
    const failed = result.data?.filter((t) => t.status === "error") ?? [];
    if (failed.length > 0) {
      console.warn("[Push] Some notifications failed:", failed.map((f) => f.message).join(", "));
    } else {
      console.log(`[Push] Sent ${validTokens.length} notification(s) successfully`);
    }
  } catch (err) {
    // Non-critical — log and continue
    console.warn("[Push] Failed to send push notification:", err);
  }
}
