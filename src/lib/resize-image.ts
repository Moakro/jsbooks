/**
 * Client-side image resize for upload.
 *
 * - Reads any browser-supported image (jpeg/png/webp/heic via canvas decode)
 * - Scales so longest side ≤ MAX_PX (default 800)
 * - Encodes as JPEG with given quality
 * - Returns a Blob ready to POST as request body
 *
 * Heavy lifting all stays in the browser; the worker only sees the resized
 * payload, never the original.
 */

export const MAX_DIM_PX = 800;
export const JPEG_QUALITY = 0.85;

export type ResizedImage = {
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
};

export async function resizeImage(
  file: File,
  maxDim: number = MAX_DIM_PX,
  quality: number = JPEG_QUALITY,
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
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("이미지 인코딩 실패");
  return { blob, width: dstW, height: dstH, contentType: "image/jpeg" };
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

/** POST a resized image to the comments-worker upload endpoint. */
export async function uploadResizedImage(file: File): Promise<{
  url: string;
  width: number;
  height: number;
}> {
  const r = await resizeImage(file);
  const res = await fetch("/api/upload/image", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": r.contentType },
    body: r.blob,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error ?? `업로드 실패 (${res.status})`);
  }
  const j = (await res.json()) as { url: string };
  return { url: j.url, width: r.width, height: r.height };
}
