import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const dir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Native-only modules replaced with lightweight, DOM-friendly mocks so
      // the React Native components can render under jsdom via react-native-web.
      {
        find: /^expo-haptics$/,
        replacement: path.resolve(dir, "test/mocks/expo-haptics.ts"),
      },
      {
        find: /^expo-location$/,
        replacement: path.resolve(dir, "test/mocks/expo-location.ts"),
      },
      {
        find: /^expo-speech$/,
        replacement: path.resolve(dir, "test/mocks/expo-speech.ts"),
      },
      {
        find: /^expo-keep-awake$/,
        replacement: path.resolve(dir, "test/mocks/expo-keep-awake.ts"),
      },
      {
        find: /^expo-file-system$/,
        replacement: path.resolve(dir, "test/mocks/expo-file-system.ts"),
      },
      {
        find: /^expo-sharing$/,
        replacement: path.resolve(dir, "test/mocks/expo-sharing.ts"),
      },
      {
        find: /^react-native-reanimated$/,
        replacement: path.resolve(dir, "test/mocks/reanimated.tsx"),
      },
      {
        find: /^@expo\/vector-icons$/,
        replacement: path.resolve(dir, "test/mocks/vector-icons.tsx"),
      },
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(dir, "test/mocks/safe-area-context.tsx"),
      },
      {
        find: /^@clerk\/expo$/,
        replacement: path.resolve(dir, "test/mocks/clerk-expo.tsx"),
      },
      {
        find: /^expo-router$/,
        replacement: path.resolve(dir, "test/mocks/expo-router.tsx"),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(dir, "test/mocks/react-native-svg.tsx"),
      },
      // react-native -> react-native-web so primitives render to the DOM.
      { find: /^react-native$/, replacement: "react-native-web" },
      // Path alias used across the app.
      { find: /^@\/(.*)$/, replacement: path.resolve(dir, "$1") },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", ".expo/**"],
  },
});
