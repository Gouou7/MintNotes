import { detectImageMime } from "./attachmentFormat";

const AVATAR_SIZE = 256;
const MAX_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("无法处理头像图片")),
    type,
    quality
  ));
}

export async function prepareProfileAvatar(file: File): Promise<{ mime: string; data: ArrayBuffer }> {
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error("头像原图不能超过 10 MiB");
  const source = await file.arrayBuffer();
  const mime = detectImageMime(new Uint8Array(source));
  if (!mime) throw new Error("请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片");
  const bitmap = await createImageBitmap(new Blob([source], { type: mime }));
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - side) / 2);
    const sourceY = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理头像图片");
    context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    let output: Blob;
    try {
      output = await canvasBlob(canvas, "image/webp", .86);
    } catch {
      output = await canvasBlob(canvas, "image/png");
    }
    return { mime: output.type || "image/png", data: await output.arrayBuffer() };
  } finally {
    bitmap.close();
  }
}
