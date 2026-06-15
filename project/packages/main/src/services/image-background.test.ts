import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { removeSolidBackground } from "./image-background";

/** Build a PNG: solid `bg` everywhere, then a filled `fg` rectangle inside. */
function makeImage(
  width: number,
  height: number,
  bg: [number, number, number],
  fg: [number, number, number],
  rect: { x: number; y: number; w: number; h: number }
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const inFg = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, g, b] = inFg ? fg : bg;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function alphaAt(buffer: Buffer, x: number, y: number): number {
  const png = PNG.sync.read(buffer);
  return png.data[(y * png.width + x) * 4 + 3];
}

describe("removeSolidBackground", () => {
  it("clears a uniform white background but keeps the centered subject opaque", () => {
    const input = makeImage(40, 40, [255, 255, 255], [200, 40, 40], { x: 14, y: 14, w: 12, h: 12 });
    const out = removeSolidBackground(input);
    expect(alphaAt(out, 0, 0)).toBe(0); // corner background → transparent
    expect(alphaAt(out, 39, 39)).toBe(0);
    expect(alphaAt(out, 20, 20)).toBe(255); // subject center → opaque
  });

  it("preserves a same-colored region enclosed by the subject (no holes punched)", () => {
    // Red ring with a white hole in the middle (not connected to the border).
    const png = new PNG({ width: 30, height: 30 });
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        const idx = (y * 30 + x) * 4;
        const inRing = x >= 6 && x < 24 && y >= 6 && y < 24;
        const inHole = x >= 12 && x < 18 && y >= 12 && y < 18;
        const white = !inRing || inHole;
        png.data[idx] = white ? 255 : 220;
        png.data[idx + 1] = white ? 255 : 30;
        png.data[idx + 2] = white ? 255 : 30;
        png.data[idx + 3] = 255;
      }
    }
    const out = removeSolidBackground(PNG.sync.write(png));
    expect(alphaAt(out, 0, 0)).toBe(0); // outer white → removed
    expect(alphaAt(out, 15, 15)).toBe(255); // enclosed white hole → kept
    expect(alphaAt(out, 8, 8)).toBe(255); // ring → kept
  });

  it("leaves a non-uniform (busy) border image untouched — e.g. a scene background", () => {
    const png = new PNG({ width: 20, height: 20 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = (i * 7) % 256;
      png.data[i + 1] = (i * 13) % 256;
      png.data[i + 2] = (i * 29) % 256;
      png.data[i + 3] = 255;
    }
    const input = PNG.sync.write(png);
    const out = removeSolidBackground(input);
    expect(out.equals(input)).toBe(true);
  });

  it("returns non-PNG input unchanged", () => {
    const junk = Buffer.from("not a png");
    expect(removeSolidBackground(junk).equals(junk)).toBe(true);
  });
});
