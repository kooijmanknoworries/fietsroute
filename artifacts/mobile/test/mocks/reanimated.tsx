import React from "react";
import { View, Text, ScrollView } from "react-native";

export function useSharedValue<T>(initial: T) {
  return { value: initial };
}

export function useAnimatedStyle<T>(factory: () => T): T {
  return factory();
}

export function withSpring<T>(value: T): T {
  return value;
}

export function withTiming<T>(value: T): T {
  return value;
}

export function withDelay<T>(_delay: number, value: T): T {
  return value;
}

export function useAnimatedRef<T>() {
  return React.createRef<T>();
}

export function runOnJS<A extends unknown[]>(fn: (...args: A) => void) {
  return (...args: A) => fn(...args);
}

const Animated = {
  View,
  Text,
  ScrollView,
  createAnimatedComponent: <P,>(component: P) => component,
};

export default Animated;
