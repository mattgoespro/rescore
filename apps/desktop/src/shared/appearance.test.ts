import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accentInkColor,
  accentTextColor,
  DEFAULT_ACCENT_COLOR,
  THEME_CANVAS,
} from "./appearance";

function luminance(hex: string): number {
  const rgb = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test("default gold uses dark readable text", () => {
  assert.equal(accentInkColor(DEFAULT_ACCENT_COLOR), "#1A0C06");
});

test("accent foreground meets small-text contrast across custom colours", () => {
  for (let red = 0; red <= 255; red += 17) {
    for (let green = 0; green <= 255; green += 17) {
      for (let blue = 0; blue <= 255; blue += 17) {
        const background = `#${[red, green, blue].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        const a = luminance(background);
        const b = luminance(accentInkColor(background));
        assert.ok(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
          background,
        );
      }
    }
  }
});

test("accent text remains readable in both themes including tinted selections", () => {
  for (let value = 0; value <= 0xfff; value++) {
    const accent = `#${value
      .toString(16)
      .padStart(3, "0")
      .split("")
      .map((digit) => digit + digit)
      .join("")}`;
    for (const theme of ["dark", "light"] as const) {
      const foreground = luminance(accentTextColor(accent, theme));
      for (const surface of [
        THEME_CANVAS[theme],
        theme === "light" ? "#FFFFFF" : "#17171B",
      ]) {
        const tinted = `#${[1, 3, 5]
          .map((offset) =>
            Math.round(
              parseInt(surface.slice(offset, offset + 2), 16) * 0.86 +
                parseInt(accent.slice(offset, offset + 2), 16) * 0.14,
            )
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`;
        for (const background of [surface, tinted]) {
          const b = luminance(background);
          assert.ok(
            (Math.max(foreground, b) + 0.05) /
              (Math.min(foreground, b) + 0.05) >=
              4.5,
            `${theme} ${accent} on ${background}`,
          );
        }
      }
    }
  }
});
