export type AppTheme =
  | "blue-calm"
  | "soft-green"
  | "peach-soft"
  | "lavender-minimal"
  | "warm-sand"
  | "aqua-light"
  | "dark-elegant"
  | "clean-light";

export interface ThemeMeta {
  id: AppTheme;
  name: string;
  dark: boolean;
  preview: {
    bg: string;
    surface: string;
    primary: string;
    accent: string;
  };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "blue-calm",
    name: "Blue Calm",
    dark: false,
    preview: { bg: "#F4F8FB", surface: "#FFFFFF", primary: "#7FB3D5", accent: "#5DADE2" },
  },
  {
    id: "soft-green",
    name: "Soft Green",
    dark: false,
    preview: { bg: "#F3FBF6", surface: "#FFFFFF", primary: "#82C4A0", accent: "#58D68D" },
  },
  {
    id: "peach-soft",
    name: "Peach Soft",
    dark: false,
    preview: { bg: "#FFF6F5", surface: "#FFFFFF", primary: "#F5B7B1", accent: "#F1948A" },
  },
  {
    id: "lavender-minimal",
    name: "Lavender",
    dark: false,
    preview: { bg: "#FAF7FC", surface: "#FFFFFF", primary: "#C39BD3", accent: "#AF7AC5" },
  },
  {
    id: "warm-sand",
    name: "Warm Sand",
    dark: false,
    preview: { bg: "#FBF9F4", surface: "#FFFFFF", primary: "#D5C4A1", accent: "#C8AE7D" },
  },
  {
    id: "aqua-light",
    name: "Aqua Light",
    dark: false,
    preview: { bg: "#F2FBFA", surface: "#FFFFFF", primary: "#76D7C4", accent: "#48C9B0" },
  },
  {
    id: "dark-elegant",
    name: "Dark Elegant",
    dark: true,
    preview: { bg: "#121417", surface: "#1C1F26", primary: "#5DADE2", accent: "#3498DB" },
  },
  {
    id: "clean-light",
    name: "Clean Light",
    dark: false,
    preview: { bg: "#FFFFFF", surface: "#F8F9FA", primary: "#4A90E2", accent: "#357ABD" },
  },
];

export const DEFAULT_THEME: AppTheme = "blue-calm";
export const THEME_STORAGE_KEY = "app-color-theme";
