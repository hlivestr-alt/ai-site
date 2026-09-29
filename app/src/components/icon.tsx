import type { CSSProperties } from "react";
const paths = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  video: "M4 4h16v16H4ZM10 8l6 4-6 4Z",
  scissors: "M8 8l12 12M8 16 20 4M4 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM4 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  send: "m22 2-7 20-4-9L2 9 22 2ZM11 13 22 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 6v6l4 2",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  sparkles: "m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3ZM21 1v4m-2-2h4",
  shield: "m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  moon: "M21 14A9 9 0 0 1 10 3a9 9 0 1 0 11 11Z",
  monitor: "M3 3h18v14H3ZM12 17v4m-4 0h8",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 6 0 0 1 16 0v3",
  logout: "M10 3H3v18h7M8 12h13m-5-5 5 5-5 5",
  lock: "M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4",
  image: "M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M16 7h.01",
  plus: "M12 4v16M4 12h16",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  check: "m5 12 4 4L19 6",
  alert: "m12 3 10 18H2ZM12 9v5m0 3h.01",
  activity: "M2 12h5l3-9 4 18 3-9h5",
  link: "m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  layers: "m12 3 10 5-10 5L2 8ZM2 12l10 5 10-5M2 16l10 5 10-5",
  file: "M4 2h10l6 6v14H4ZM14 2v6h6M8 13h8m-8 4h6",
  close: "m6 6 12 12M6 18 18 6",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
