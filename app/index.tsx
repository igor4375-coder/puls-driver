import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/use-colors";

export default function Index() {
  const { isSignedIn, isLoaded } = useAuth();
  const colors = useColors();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      router.replace("/(tabs)");
    } else {
      router.replace("/(auth)/welcome" as any);
    }
  }, [isSignedIn, isLoaded]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
