// SPIKE design tokens - iOS-Native Clean, Deep Moss Green brand.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#1C201E",
  surfaceSecondary: "#F4F5F4",
  onSurfaceSecondary: "#2A312D",
  surfaceTertiary: "#EAECEA",
  onSurfaceTertiary: "#2A312D",
  surfaceInverse: "#1C201E",
  onSurfaceInverse: "#FFFFFF",
  muted: "#7A827D",

  brand: "#2A4D3B",
  onBrand: "#FFFFFF",
  brandPrimary: "#2A4D3B",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#4A6D5B",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E3E8E5",
  onBrandTertiary: "#2A4D3B",

  success: "#356645",
  onSuccess: "#FFFFFF",
  warning: "#D48D3B",
  onWarning: "#FFFFFF",
  error: "#B34040",
  onError: "#FFFFFF",
  info: "#665540",
  onInfo: "#FFFFFF",

  border: "#EAECEA",
  borderStrong: "#C8CDC9",
  divider: "#EAECEA",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;
