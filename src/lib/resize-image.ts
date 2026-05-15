/**
 * Client-side image resize + per-user dedup for upload.
 *
 * - Reads any browser-supported image (jpeg/png/webp/heic via canvas decode)
 * - Scales so longest side ≤ MAX_DIM_PX (default 1600)
 * - Encodes as WebP with given quality (default 0.85)
 * - Computes sha256 hex of the resized blob and asks the worker if this
 *   user already uploaded the same content — if so, returns the existing
 *   URL without sending bytes again.
 *
 * Heavy lifting (decode, resize, encode, hash) all stays in the browser;
 * the worker only sees the final resized payload, never the original.
 */

export const MAX_DIM_PX = 1600;
export const WEBP_QUALITY = 0.85;
export const OUTPUT_CONTENT_TYPE = "image/webp";

export type ResizedImage = {
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
};

export async function resizeImage(
  file: File,
  maxDim: number = MAX_DIM_PX,
  quality: number = WEBP_QUALITY,
): Promise<ResizedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드 가능합니다");
  }

  const bitmap = await loadBitmap(file);
  const { width: srcW, height: srcH } = bitmap;
  const ratio = Math.min(1, maxDim / Math.max(srcW, srcH));
  const dstW = Math.round(srcW * ratio);
  const dstH = Math.round(srcH * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  if ("close" in bitmap && typeof (bitmap as ImageBitmap).close === "function") {
    (bitmap as ImageBitmap).close();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_CONTENT_TYPE, quality),
  );
  if (!blob) throw new Error("이미지 인코딩 실패");
  return { blob, width: dstW, height: dstH, contentType: OUTPUT_CONTENT_TYPE };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> path (some browsers reject HEIC etc.)
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Resize → hash → ask worker for prior upload → upload only if new.
 * Returns { url, width, height } in both cached and fresh cases.
 */
export async function uploadResizedImage(file: File): Promise<{
  url: string;
  width: number;
  height: number;
}> {
  const r = await resizeImage(file);
  const hash = await sha256Hex(r.blob);

  // 사용자가 같은 사진을 이미 올린 적이 있으면 그 URL을 그대로 사용한다.
  // /api/upload/check 실패 시(네트워크·인증) 그냥 신규 업로드로 진행.
  try {
    const check = await fetch("/api/upload/check", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash }),
    });
    if (check.ok) {
      const j = (await check.json()) as { exists?: boolean; url?: string; width?: number; height?: number };
      if (j.exists && j.url) {
        return { url: j.url, width: j.width ?? r.width, height: j.height ?? r.height };
      }
    }
  } catch {
    // ignore — fall through to upload
  }

  const res = await fetch("/api/upload/image", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": r.contentType,
      "X-Upload-Hash": hash,
      "X-Image-Width": String(r.width),
      "X-Image-Height": String(r.height),
    },
    body: r.blob,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error ?? `업로드 실패 (${res.status})`);
  }
  const j = (await res.json()) as { url: string; width?: number; height?: number };
  return { url: j.url, width: j.width ?? r.width, height: j.height ?? r.height };
}
