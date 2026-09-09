export const APP_BASE_URL = import.meta.env.VITE_APP_BASE_URL || window.location.origin;
export const QR_DEFAULT_SIZE = 1024;
export const QR_STYLES = ["square", "dots", "rounded", "classy", "extra-rounded"] as const;
export const CORNER_STYLES = ["square", "dot", "extra-rounded"] as const;
export const DEFAULT_SETTINGS = {
  dotsColor: "#0f172a",
  backgroundColor: "#ffffff",
  dotsType: "rounded" as string,
  cornersType: "extra-rounded" as string,
  gradient: false,
  gradientColor2: "#0ea5e9",
};
export const RECENT_STORAGE_KEY = "pendekin_recent";
export const MAX_RECENT = 10;
