// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

const bundleId = "com.pulsdispatch.driver";

const env = {
  appName: "Puls Driver",
  appSlug: "puls-driver",
  scheme: "pulsdriver",
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "UIBackgroundModes": ["location", "fetch"]
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS", "ACCESS_BACKGROUND_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-location",
      {
        "locationWhenInUsePermission": "Allow Puls Driver to access your location to stamp GPS coordinates on inspection photos for tamper-evident chain-of-custody records.",
        "locationAlwaysAndWhenInUsePermission": "Allow Puls Driver to access your location in the background so dispatch can see your position while you are on a route.",
        "isAndroidBackgroundLocationEnabled": true,
        "isAndroidForegroundServiceEnabled": true
      }
    ],
    [
      "expo-camera",
      {
        "cameraPermission": "Allow Puls Driver to access your camera to scan VIN barcodes and capture inspection photos."
      }
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow $(PRODUCT_NAME) to access your photos for vehicle inspection.",
        cameraPermission: "Allow $(PRODUCT_NAME) to use your camera to take inspection photos.",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  updates: {
    url: "https://u.expo.dev/cc2a03cc-5910-464c-8b9a-7dc09c2eda48",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  extra: {
    eas: {
      projectId: "cc2a03cc-5910-464c-8b9a-7dc09c2eda48",
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
