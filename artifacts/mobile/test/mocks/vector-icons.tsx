import React from "react";
import { Text } from "react-native";

type IconProps = { name?: string; size?: number; color?: string };

function makeIconSet() {
  return ({ name }: IconProps) => <Text>{name ?? ""}</Text>;
}

export const Ionicons = makeIconSet();
export const MaterialCommunityIcons = makeIconSet();
export const MaterialIcons = makeIconSet();
export const FontAwesome = makeIconSet();
export const Feather = makeIconSet();
