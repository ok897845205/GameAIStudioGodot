import { PNG } from "pngjs";

/**
 * Auto-removes a solid background from a generated sprite so it drops into a
 * Godot scene as a transparent cutout instead of an opaque square.
 *
 * Most image models (nano-banana / gemini, chat-image) can't emit a real alpha
 * channel — asking for a "transparent background" just yields a flat white /
 * cream / grey fill. This flood-fills that fill away: it samples the border,
 * and from every border pixel within a colour tolerance walks inward marking
 * connected background pixels transparent. Because it only removes background
 * CONNECTED TO THE BORDER, a same-coloured region enclosed by the subject
 * (e.g. a white glint inside the sprite) is preserved — no holes punched in art.
 *
 * Conservative by design: if the border isn't a reasonably uniform solid
 * colour (e.g. a full-frame background scene, or an already-transparent image),
 * it returns the original bytes untouched.
 */

export interface RemoveBackgroundOptions {
  /** Max RGB euclidean distance from the sampled background colour to treat a pixel as background. */
  tolerance?: number;
  /** Border pixels must be this uniform (max corner spread) or we skip removal. */
  uniformityLimit?: number;
}

interface RgbaImage {
  width: number;
  height: number;
  data: Buffer; // RGBA, 4 bytes per pixel
}

function colorDistance(data: Buffer, a: number, b: number): number {
  const dr = data[a] - data[b];
  const dg = data[a + 1] - data[b + 1];
  const db = data[a + 2] - data[b + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function distanceToColor(data: Buffer, idx: number, r: number, g: number, b: number): number {
  const dr = data[idx] - r;
  const dg = data[idx + 1] - g;
  const db = data[idx + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Average colour of the four corner pixels, plus how spread out they are. */
function sampleBorder(image: RgbaImage): { r: number; g: number; b: number; spread: number } {
  const { width, height, data } = image;
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of corners) {
    r += data[c];
    g += data[c + 1];
    b += data[c + 2];
  }
  r = Math.round(r / corners.length);
  g = Math.round(g / corners.length);
  b = Math.round(b / corners.length);
  let spread = 0;
  for (let i = 0; i < corners.length; i += 1) {
    for (let j = i + 1; j < corners.length; j += 1) {
      spread = Math.max(spread, colorDistance(data, corners[i], corners[j]));
    }
  }
  return { r, g, b, spread };
}

/**
 * Returns a new PNG buffer with the border-connected solid background made
 * transparent, or the original buffer unchanged when removal isn't applicable
 * or fails. Never throws.
 */
export function removeSolidBackground(pngBuffer: Buffer, options: RemoveBackgroundOptions = {}): Buffer {
  const tolerance = options.tolerance ?? 42;
  const uniformityLimit = options.uniformityLimit ?? 36;

  let image: RgbaImage;
  try {
    const decoded = PNG.sync.read(pngBuffer);
    image = { width: decoded.width, height: decoded.height, data: decoded.data };
  } catch {
    return pngBuffer; // not a PNG / undecodable — leave it alone
  }

  const { width, height, data } = image;
  if (width < 2 || height < 2) return pngBuffer;

  const bg = sampleBorder(image);
  // Border isn't a clean solid colour (scene/full-frame art) → don't touch it.
  if (bg.spread > uniformityLimit) return pngBuffer;

  const total = width * height;
  const visited = new Uint8Array(total);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    const idx = p * 4;
    if (data[idx + 3] === 0) {
      visited[p] = 1;
      return;
    }
    if (distanceToColor(data, idx, bg.r, bg.g, bg.b) <= tolerance) {
      visited[p] = 1;
      stack.push(p);
    }
  };

  // Seed from every border pixel.
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  let cleared = 0;
  while (stack.length > 0) {
    const p = stack.pop()!;
    data[p * 4 + 3] = 0; // make transparent
    cleared += 1;
    const x = p % width;
    const y = (p - x) / width;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  // Nothing removed (border didn't match its own sample — odd) → original.
  if (cleared === 0) return pngBuffer;
  // Almost everything removed → the "subject" was background-coloured too;
  // returning a near-empty image would be worse than the square. Bail out.
  if (cleared > total * 0.97) return pngBuffer;

  // Soften the 1px halo: edge pixels still close to the background fade out.
  for (let p = 0; p < total; p += 1) {
    const idx = p * 4;
    if (data[idx + 3] === 0) continue;
    const x = p % width;
    const y = (p - x) / width;
    const touchesCleared =
      (x > 0 && data[(p - 1) * 4 + 3] === 0) ||
      (x < width - 1 && data[(p + 1) * 4 + 3] === 0) ||
      (y > 0 && data[(p - width) * 4 + 3] === 0) ||
      (y < height - 1 && data[(p + width) * 4 + 3] === 0);
    if (!touchesCleared) continue;
    const dist = distanceToColor(data, idx, bg.r, bg.g, bg.b);
    if (dist < tolerance * 1.6) {
      const ratio = Math.max(0, Math.min(1, (dist - tolerance * 0.6) / (tolerance)));
      data[idx + 3] = Math.round(data[idx + 3] * ratio);
    }
  }

  const out = new PNG({ width, height });
  data.copy(out.data);
  return PNG.sync.write(out);
}
