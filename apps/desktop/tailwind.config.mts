import forms from "@tailwindcss/forms";
import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const palette = {
  canvas: "var(--imd-canvas)",
  ink: "var(--imd-ink)",
  muted: "var(--imd-muted)",
  faint: "var(--imd-faint)",
  line: "var(--imd-line)",
  accent: "var(--imd-accent)",
  accent2: "var(--imd-accent-2)",
  accentSoft: "var(--imd-accent-soft)",
  accentInk: "var(--imd-accent-ink)",
  danger: "var(--imd-danger)",
  dangerFg: "var(--imd-danger-fg)",
  raised: "var(--imd-raised)",
  rail: "var(--imd-rail)",
  track: "var(--imd-track)",
  thumb: "var(--imd-thumb)",
  thumbActive: "var(--imd-thumb-active)",
  input: "var(--imd-input)",
  poster: "var(--imd-poster)",
} as const;

const rescore = plugin(({ addUtilities }) => {
  addUtilities({
    ".app-drag": {
      "-webkit-app-region": "drag",
    },
    ".app-no-drag": {
      "-webkit-app-region": "no-drag",
    },
    ".scrollbar-none": {
      "scrollbar-width": "none",
      "&::-webkit-scrollbar": {
        display: "none",
        width: "0",
        height: "0",
      },
    },
  });
});

export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        inspect: "1181px",
      },
      colors: {
        canvas: palette.canvas,
        ink: palette.ink,
        muted: palette.muted,
        faint: palette.faint,
        line: palette.line,
        accent: {
          DEFAULT: palette.accent,
          2: palette.accent2,
          soft: palette.accentSoft,
          ink: palette.accentInk,
        },
        danger: {
          DEFAULT: palette.danger,
          fg: palette.dangerFg,
        },
        raised: palette.raised,
        rail: palette.rail,
        track: palette.track,
        thumb: palette.thumb,
        "thumb-active": palette.thumbActive,
        input: palette.input,
        poster: palette.poster,
        wash: {
          DEFAULT: "var(--imd-wash-05)",
          3: "var(--imd-wash-03)",
          5: "var(--imd-wash-05)",
          6: "var(--imd-wash-06)",
          8: "var(--imd-wash-08)",
          9: "var(--imd-wash-09)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontWeight: {
        650: "650",
      },
      borderRadius: {
        app: "10px",
      },
      boxShadow: {
        panel: "var(--imd-shadow-panel)",
        accent:
          "0 6px 16px color-mix(in srgb, var(--imd-accent) 28%, transparent)",
      },
      letterSpacing: {
        title: "-0.04em",
        tightish: "-0.02em",
        kicker: "0.18em",
      },
      transitionDuration: {
        140: "140ms",
        160: "160ms",
      },
      keyframes: {
        "result-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        catalog: "spin 0.7s linear infinite",
        "result-in": "result-in 160ms ease both",
        fade: "fade 200ms ease",
      },
    },
  },
  plugins: [forms({ strategy: "class" }), typography, rescore],
} satisfies Config;
