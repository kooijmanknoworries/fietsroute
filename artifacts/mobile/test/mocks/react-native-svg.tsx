import React from "react";
import { View } from "react-native";

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

function makeSvgComponent(testID?: string) {
  return ({ children }: AnyProps) => (
    <View testID={testID}>{children}</View>
  );
}

const Svg = makeSvgComponent("svg-root");
export const Path = makeSvgComponent();
export const Line = makeSvgComponent();
export const Circle = makeSvgComponent();
export const Rect = makeSvgComponent();
export const G = makeSvgComponent();
export const Polyline = makeSvgComponent();
export const Polygon = makeSvgComponent();
export const Text = makeSvgComponent();
export const Defs = makeSvgComponent();
export const LinearGradient = makeSvgComponent();
export const Stop = makeSvgComponent();

export default Svg;
