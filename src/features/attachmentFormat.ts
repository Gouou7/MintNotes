import type { VaultAttachment } from "../types";

export const ATTACHMENT_URL_PATTERN = /webmd-attachment:([0-9a-f-]{36})/gi;

function bytesMatch(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

export function detectImageMime(bytes: Uint8Array): VaultAttachment["mime"] | null {
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytesMatch(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a") return "image/gif";
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (new TextDecoder().decode(bytes.subarray(4, 12)).includes("ftypavif")) return "image/avif";
  return null;
}

export function attachmentIdsIn(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(ATTACHMENT_URL_PATTERN)) ids.add(match[1].toLowerCase());
  return [...ids];
}

export function attachmentMarkdown(attachmentId: string, name: string): string {
  const alt = name.replace(/[\[\]]/g, "_");
  return `\n![${alt}](webmd-attachment:${attachmentId})\n`;
}

export function materializeAttachmentUrls(markdown: string, attachmentUrls: Map<string, string>): string {
  return markdown.replace(ATTACHMENT_URL_PATTERN, (reference, attachmentId: string) => (
    attachmentUrls.get(attachmentId.toLowerCase()) ?? reference
  ));
}

export function canonicalizeAttachmentUrls(markdown: string, attachmentUrls: Map<string, string>): string {
  let canonical = markdown;
  for (const [attachmentId, url] of attachmentUrls) {
    canonical = canonical.split(url).join(`webmd-attachment:${attachmentId}`);
  }
  return canonical;
}

export function extensionForMime(mime: VaultAttachment["mime"]): string {
  return mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
}
