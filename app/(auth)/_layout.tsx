import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="phone-entry" />
      <Stack.Screen name="phone-verify" />
      <Stack.Screen name="invite" />
    </Stack>
  );
}
