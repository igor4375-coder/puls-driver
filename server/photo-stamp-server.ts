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
  line2: string; // e.g. "Driver: D-11903  ·  AutoHaul"
}

/**
 * Burn a GPS/timestamp evidence stamp onto a JPEG/PNG image buffer.
 * Returns a new JPEG buffer with the stamp composited at the bottom.
 */
export async function stampPhotoBuffer(
  inputBuffer: Buffer,
  opts: ServerStampOptions
): Promise<Buffer> {
  // Get image dimensions
  const meta = await sharp(inputBuffer).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1440;

  // Banner height: ~8% of image height, min 80px
  const bannerH = Math.max(80, Math.round(h * 0.08));

  // Font size scales with image width: ~2.2% of width, min 18px
  const fontSize = Math.max(18, Math.round(w * 0.022));
  const fontSize2 = Math.max(15, Math.round(w * 0.018));
  const lineH = Math.round(fontSize * 1.5);
  const padding = Math.round(w * 0.025);
  const accentW = Math.round(w * 0.008);
  const accentGap = Math.round(w * 0.015);

  // Text x start (after accent bar)
  const textX = padding + accentW + accentGap;
  const textMaxW = w - textX - padding;

  // Vertical centering of two lines within banner
  const totalTextH = lineH + Math.round(fontSize2 * 1.4);
  const textStartY = Math.round((bannerH - totalTextH) / 2) + fontSize;

  // Build SVG overlay
  const svgOverlay = `
<svg width="${w}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg">
  <!-- Dark semi-transparent background -->
  <rect x="0" y="0" width="${w}" height="${bannerH}" fill="rgba(0,0,0,0.85)" />
  <!-- Blue accent bar -->
  <rect x="${padding}" y="${Math.round(bannerH * 0.15)}" width="${accentW}" height="${Math.round(bannerH * 0.7)}" fill="#2563EB" rx="${Math.round(accentW / 2)}" />
  <!-- Line 1: bold white -->
  <text
    x="${textX}"
    y="${textStartY}"
    font-family="monospace, Courier New, Courier"
    font-size="${fontSize}"
    font-weight="700"
    fill="#FFFFFF"
    text-anchor="start"
    dominant-baseline="auto"
  >${escapeXml(truncateText(opts.line1, textMaxW, fontSize))}</text>
  <!-- Line 2: lighter -->
  <text
    x="${textX}"
    y="${textStartY + Math.round(fontSize2 * 1.55)}"
    font-family="monospace, Courier New, Courier"
    font-size="${fontSize2}"
    font-weight="400"
    fill="rgba(255,255,255,0.80)"
    text-anchor="start"
    dominant-baseline="auto"
  >${escapeXml(opts.line2)}</text>
</svg>`;

  const svgBuffer = Buffer.from(svgOverlay);

  // Composite: place banner at the bottom of the original image
  const stamped = await sharp(inputBuffer)
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
 * Assumes monospace font: ~0.6 × fontSize per character.
 */
function truncateText(text: string, maxWidth: number, fontSize: number): string {
  const charW = fontSize * 0.6;
  const maxChars = Math.floor(maxWidth / charW);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
