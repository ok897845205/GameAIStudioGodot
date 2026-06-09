import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const iconSize = 256;

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(left, right, t) {
  return Math.round(left + (right - left) * t);
}

function signedRoundedRect(px, py, x, y, width, height, radius) {
  const qx = Math.abs(px - (x + width / 2)) - (width / 2 - radius);
  const qy = Math.abs(py - (y + height / 2)) - (height / 2 - radius);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function inRoundedRect(px, py, x, y, width, height, radius) {
  return signedRoundedRect(px, py, x, y, width, height, radius) <= 0;
}

function inCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) <= radius;
}

function inRect(px, py, x, y, width, height) {
  return px >= x && px <= x + width && py >= y && py <= y + height;
}

function inSpark(px, py, cx, cy, radius) {
  return Math.abs(px - cx) + Math.abs(py - cy) <= radius || Math.hypot(px - cx, py - cy) <= radius * 0.42;
}

function overlay(pixel, color, alpha = 1) {
  const nextAlpha = clamp(color[3] * alpha) / 255;
  const currentAlpha = pixel[3] / 255;
  const outAlpha = nextAlpha + currentAlpha * (1 - nextAlpha);
  if (outAlpha <= 0) {
    return [0, 0, 0, 0];
  }
  return [
    clamp((color[0] * nextAlpha + pixel[0] * currentAlpha * (1 - nextAlpha)) / outAlpha),
    clamp((color[1] * nextAlpha + pixel[1] * currentAlpha * (1 - nextAlpha)) / outAlpha),
    clamp((color[2] * nextAlpha + pixel[2] * currentAlpha * (1 - nextAlpha)) / outAlpha),
    clamp(outAlpha * 255)
  ];
}

function renderPixel(x, y, size) {
  const scale = size / iconSize;
  const px = x / scale;
  const py = y / scale;
  let pixel = [0, 0, 0, 0];

  if (inRoundedRect(px, py, 14, 14, 228, 228, 54)) {
    const t = (px + py) / (iconSize * 2);
    pixel = [mix(30, 17, t), mix(83, 173, t), mix(158, 130, t), 255];
  }

  if (inRoundedRect(px, py, 44, 101, 168, 70, 34) || inCircle(px, py, 68, 140, 38) || inCircle(px, py, 188, 140, 38)) {
    pixel = overlay(pixel, [244, 250, 255, 238]);
  }

  if (inRoundedRect(px, py, 93, 114, 70, 52, 16)) {
    pixel = overlay(pixel, [19, 42, 79, 232]);
  }

  if (inRect(px, py, 69, 133, 34, 10) || inRect(px, py, 81, 121, 10, 34)) {
    pixel = overlay(pixel, [23, 166, 128, 255]);
  }

  if (inCircle(px, py, 173, 130, 8) || inCircle(px, py, 190, 146, 8)) {
    pixel = overlay(pixel, [255, 199, 79, 255]);
  }

  if (inRect(px, py, 110, 128, 10, 30) || inRect(px, py, 130, 122, 10, 36) || inRect(px, py, 150, 134, 10, 24)) {
    pixel = overlay(pixel, [90, 220, 238, 255]);
  }

  if (inSpark(px, py, 190, 66, 18) || inSpark(px, py, 68, 68, 10)) {
    pixel = overlay(pixel, [255, 215, 105, 255]);
  }

  return pixel;
}

function createIco(size) {
  const pixelData = Buffer.alloc(size * size * 4);
  let offset = 0;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = renderPixel(x + 0.5, y + 0.5, size);
      pixelData[offset++] = b;
      pixelData[offset++] = g;
      pixelData[offset++] = r;
      pixelData[offset++] = a;
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size);
  const bitmapHeader = Buffer.alloc(40);
  bitmapHeader.writeUInt32LE(40, 0);
  bitmapHeader.writeInt32LE(size, 4);
  bitmapHeader.writeInt32LE(size * 2, 8);
  bitmapHeader.writeUInt16LE(1, 12);
  bitmapHeader.writeUInt16LE(32, 14);
  bitmapHeader.writeUInt32LE(0, 16);
  bitmapHeader.writeUInt32LE(pixelData.length + mask.length, 20);

  const image = Buffer.concat([bitmapHeader, pixelData, mask]);
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0);
  iconDir.writeUInt16LE(1, 2);
  iconDir.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(iconDir.length + entry.length, 12);

  return Buffer.concat([iconDir, entry, image]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="24" x2="232" y1="24" y2="232" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1e539e"/>
      <stop offset="1" stop-color="#11ad82"/>
    </linearGradient>
  </defs>
  <rect x="14" y="14" width="228" height="228" rx="54" fill="url(#bg)"/>
  <path d="M68 102h120a34 34 0 0 1 28 53 38 38 0 0 1-59 8H99a38 38 0 0 1-59-8 34 34 0 0 1 28-53Z" fill="#f4faff" fill-opacity=".94"/>
  <rect x="93" y="114" width="70" height="52" rx="16" fill="#132a4f" fill-opacity=".92"/>
  <path d="M69 133h34v10H69zm12-12h10v34H81z" fill="#17a680"/>
  <circle cx="173" cy="130" r="8" fill="#ffc74f"/>
  <circle cx="190" cy="146" r="8" fill="#ffc74f"/>
  <path d="M110 128h10v30h-10zm20-6h10v36h-10zm20 12h10v24h-10z" fill="#5adcee"/>
  <path d="M190 48l8 18 18 8-18 8-8 18-8-18-18-8 18-8 8-18zM68 58l5 10 10 5-10 5-5 10-5-10-10-5 10-5 5-10z" fill="#ffd769"/>
</svg>
`;

await mkdir(buildDir, { recursive: true });
await writeFile(path.join(buildDir, "icon.svg"), `${svg}\n`, "utf8");
await writeFile(path.join(buildDir, "icon.ico"), createIco(iconSize));
console.log(`Generated ${path.relative(root, path.join(buildDir, "icon.ico"))}`);
