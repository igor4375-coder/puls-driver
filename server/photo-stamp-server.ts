/**
 * photo-stamp-server.ts
 *
 * Server-side photo stamping using Sharp.
 * Burns a dark evidence banner at the bottom of the photo containing:
 *   - Inspection type + date + time + location
 *   - Driver code + company name
 *
 * Uses Sharp's built-in Pango text renderer with a bundled font file
 * so it works on minimal containers without system fonts.
 */

import sharp from "sharp";
import path from "path";
import fs from "fs";

function findFontPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "server", "assets", "Inter.ttf"),
    path.resolve(__dirname, "server", "assets", "Inter.ttf"),
    path.resolve(process.cwd(), "server", "assets", "Inter.ttf"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

const FONT_PATH = findFontPath();

export interface ServerStampOptions {
  line1: string;
  line2: string;
}

/**
 * Burn a GPS/timestamp evidence stamp onto a JPEG/PNG image buffer.
 * Returns a new JPEG buffer with the stamp composited at the bottom.
 */
export async function stampPhotoBuffer(
  inputBuffer: Buffer,
  opts: ServerStampOptions
): Promise<Buffer> {
  const oriented = await sharp(inputBuffer).rotate().toBuffer();

  const meta = await sharp(oriented).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1440;

  const shortSide = Math.min(w, h);
  const bannerH = Math.max(56, Math.round(shortSide * 0.055));
  const padding = Math.round(w * 0.02);
  const accentW = Math.round(w * 0.005);
  const accentGap = Math.round(w * 0.01);
  const textX = padding + accentW + accentGap;

  const fontSize = Math.max(14, Math.round(shortSide * 0.018));
  const fontSize2 = Math.max(12, Math.round(shortSide * 0.015));

  // Render text lines as transparent PNGs using Sharp's Pango text engine
  const renderText = (text: string, size: number, bold: boolean, color: string) =>
    sharp({
      text: {
        text: `<span foreground="${color}">${escapePango(text)}</span>`,
        fontfile: FONT_PATH,
        font: bold ? "Inter Bold" : "Inter",
        width: w - textX - padding,
        dpi: Math.round(size * 7.2),
        rgba: true,
      },
    })
      .png()
      .toBuffer();

  let line1Buf: Buffer;
  let line2Buf: Buffer;

  try {
    [line1Buf, line2Buf] = await Promise.all([
      renderText(opts.line1, fontSize, true, "#FFFFFF"),
      renderText(opts.line2, fontSize2, false, "#BFBFBF"),
    ]);
  } catch {
    // Pango text failed — fall back to SVG-only approach (no text)
    return svgFallback(oriented, w, h, bannerH, padding, accentW, opts);
  }

  const line1Meta = await sharp(line1Buf).metadata();
  const line2Meta = await sharp(line2Buf).metadata();
  const line1H = line1Meta.height ?? fontSize;
  const line2H = line2Meta.height ?? fontSize2;

  const totalTextH = line1H + 2 + line2H;
  const textTopOffset = Math.round((bannerH - totalTextH) / 2);

  // Dark banner background with blue accent bar (no text — text composited separately)
  const bannerSvg = Buffer.from(`
<svg width="${w}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${bannerH}" fill="rgba(0,0,0,0.55)" />
  <rect x="${padding}" y="${Math.round(bannerH * 0.18)}" width="${accentW}" height="${Math.round(bannerH * 0.64)}" fill="#2563EB" rx="${Math.round(accentW / 2)}" />
</svg>`);

  const stamped = await sharp(oriented)
    .composite([
      { input: bannerSvg, top: h - bannerH, left: 0 },
      { input: line1Buf, top: h - bannerH + textTopOffset, left: textX },
      { input: line2Buf, top: h - bannerH + textTopOffset + line1H + 2, left: textX },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();

  return stamped;
}

/** Fallback: banner without text if Pango rendering is unavailable */
async function svgFallback(
  oriented: Buffer,
  w: number,
  h: number,
  bannerH: number,
  padding: number,
  accentW: number,
  opts: ServerStampOptions
): Promise<Buffer> {
  const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.018));
  const fontSize2 = Math.max(12, Math.round(Math.min(w, h) * 0.015));
  const accentGap = Math.round(w * 0.01);
  const textX = padding + accentW + accentGap;
  const textMaxW = w - textX - padding;
  const lineH = Math.round(fontSize * 1.4);
  const totalTextH = lineH + Math.round(fontSize2 * 1.3);
  const textStartY = Math.round((bannerH - totalTextH) / 2) + fontSize;

  const svgOverlay = Buffer.from(`
<svg width="${w}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${bannerH}" fill="rgba(0,0,0,0.55)" />
  <rect x="${padding}" y="${Math.round(bannerH * 0.18)}" width="${accentW}" height="${Math.round(bannerH * 0.64)}" fill="#2563EB" rx="${Math.round(accentW / 2)}" />
  <text x="${textX}" y="${textStartY}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(opts.line1, textMaxW, fontSize))}</text>
  <text x="${textX}" y="${textStartY + Math.round(fontSize2 * 1.45)}" font-family="sans-serif" font-size="${fontSize2}" fill="rgba(255,255,255,0.75)">${escapeXml(opts.line2)}</text>
</svg>`);

  return sharp(oriented)
    .composite([{ input: svgOverlay, top: h - bannerH, left: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapePango(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(text: string, maxWidth: number, fontSize: number): string {
  const charW = fontSize * 0.55;
  const maxChars = Math.floor(maxWidth / charW);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
