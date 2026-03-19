/**
 * Storage service — uploads/deletes files on Cloudflare R2 (S3-compatible).
 *
 * Presigned URL flow for photo uploads:
 *   1. Client calls GET /api/photos/upload-url → receives { uploadUrl, publicUrl, key }
 *   2. Client PUTs the file directly to uploadUrl (never touches our server)
 *   3. Client uses publicUrl when syncing inspection data
 *
 * Legacy server-side upload (storagePut) is kept for receipts, gate passes, etc.
 * that still upload through the Express server.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── Config ──────────────────────────────────────────────────────────────────

function getR2Config() {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || "auto";
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const publicUrlBase = process.env.S3_PUBLIC_URL; // e.g. https://photos.yourdomain.com

  if (!bucket || !endpoint || !accessKey || !secretKey) {
    throw new Error(
      "R2/S3 credentials missing. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY in .env",
    );
  }

  return { bucket, region, endpoint, accessKey, secretKey, publicUrlBase };
}

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const { region, endpoint, accessKey, secretKey } = getR2Config();
  _client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true,
  });
  return _client;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function buildPublicUrl(key: string): string {
  const { publicUrlBase, endpoint, bucket } = getR2Config();
  if (publicUrlBase) {
    return `${publicUrlBase.replace(/\/+$/, "")}/${key}`;
  }
  // Fallback: endpoint-based URL
  return `${endpoint}/${bucket}/${key}`;
}

// ─── Presigned URL (for direct client uploads) ──────────────────────────────

export async function createPresignedUploadUrl(
  relKey: string,
  contentType = "image/jpeg",
  expiresInSeconds = 300,
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const { bucket } = getR2Config();
  const key = normalizeKey(relKey);
  const client = getClient();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    publicUrl: buildPublicUrl(key),
    key,
  };
}

// ─── Server-side upload (for receipts, gate passes, etc.) ───────────────────

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { bucket } = getR2Config();
  const key = normalizeKey(relKey);
  const client = getClient();

  const body = typeof data === "string" ? Buffer.from(data) : data;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return { key, url: buildPublicUrl(key) };
}

// ─── Get URL for an existing object ─────────────────────────────────────────

export async function storageGet(
  relKey: string,
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: buildPublicUrl(key) };
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function storageDelete(relKey: string): Promise<void> {
  try {
    const { bucket } = getR2Config();
    const key = normalizeKey(relKey);
    const client = getClient();

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  } catch {
    /* best-effort delete */
  }
}
