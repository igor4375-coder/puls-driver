/**
 * photo-stamp-server.ts
 *
 * Server-side photo stamping using Sharp.
 * Burns a dark evidence banner at the bottom of the photo containing:
 *   - Inspection type + date + time + location
 *   - Driver code + company name
 *
 * This runs on the Node.js server so it works at full resolution without
 * any dependency on the device screen or React Native rendering.
 */

import sharp from "sharp";

export interface ServerStampOptions {
  line1: string; // e.g. "Pickup Condition: 2/28/2026  11:56 AM, Calgary, AB T1X 0K1"
  line2: string; // e.g. "Driver: D-11903  ·  Puls Dispatch"
}

/**
 * Burn a GPS/timestamp evidence stamp onto a JPEG/PNG image buffer.
 * Returns a new JPEG buffer with the stamp composited at the bottom.
 */
export async function stampPhotoBuffer(
  inputBuffer: Buffer,
  opts: ServerStampOptions
): Promise<Buffer> {
  // Auto-orient based on EXIF so portrait photos are physically upright
  const oriented = await sharp(inputBuffer).rotate().toBuffer();

  const meta = await sharp(oriented).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1440;

  const shortSide = Math.min(w, h);
  const bannerH = Math.max(56, Math.round(shortSide * 0.055));

  const fontSize = Math.max(14, Math.round(shortSide * 0.018));
  const fontSize2 = Math.max(12, Math.round(shortSide * 0.015));
  const lineH = Math.round(fontSize * 1.4);
  const padding = Math.round(w * 0.02);
  const accentW = Math.round(w * 0.005);
  const accentGap = Math.round(w * 0.01);

  const textX = padding + accentW + accentGap;
  const textMaxW = w - textX - padding;

  const totalTextH = lineH + Math.round(fontSize2 * 1.3);
  const textStartY = Math.round((bannerH - totalTextH) / 2) + fontSize;

  const svgOverlay = `
<svg width="${w}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${bannerH}" fill="rgba(0,0,0,0.55)" />
  <rect x="${padding}" y="${Math.round(bannerH * 0.18)}" width="${accentW}" height="${Math.round(bannerH * 0.64)}" fill="#2563EB" rx="${Math.round(accentW / 2)}" />
  <text
    x="${textX}"
    y="${textStartY}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize}"
    font-weight="700"
    fill="#FFFFFF"
    text-anchor="start"
    dominant-baseline="auto"
  >${escapeXml(truncateText(opts.line1, textMaxW, fontSize))}</text>
  <text
    x="${textX}"
    y="${textStartY + Math.round(fontSize2 * 1.45)}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize2}"
    font-weight="400"
    fill="rgba(255,255,255,0.75)"
    text-anchor="start"
    dominant-baseline="auto"
  >${escapeXml(opts.line2)}</text>
</svg>`;

  const svgBuffer = Buffer.from(svgOverlay);

  const stamped = await sharp(oriented)
    .composite([
      {
        input: svgBuffer,
        top: h - bannerH,
        left: 0,
      },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();

  return stamped;
}

/** Escape XML special characters for safe SVG text embedding */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Rough character truncation to prevent text overflow in SVG.
 * Assumes proportional sans-serif: ~0.55 × fontSize average char width.
 */
function truncateText(text: string, maxWidth: number, fontSize: number): string {
  const charW = fontSize * 0.55;
  const maxChars = Math.floor(maxWidth / charW);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
