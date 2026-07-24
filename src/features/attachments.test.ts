import { describe, expect, it } from "vitest";
import { attachmentIdsIn, canonicalizeAttachmentUrls, detectImageMime, materializeAttachmentUrls } from "./attachmentFormat";

describe("attachment helpers", () => {
  it("validates image signatures instead of trusting extensions", () => {
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it("deduplicates attachment references", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(attachmentIdsIn(`![a](webmd-attachment:${id})\n![b](webmd-attachment:${id})`)).toEqual([id]);
  });

  it("round-trips temporary Blob URLs without changing canonical Markdown", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const canonical = `before ![image](webmd-attachment:${id}) after`;
    const urls = new Map([[id, "blob:http://localhost/temporary-image"]]);
    const rendered = materializeAttachmentUrls(canonical, urls);
    expect(rendered).toBe("before ![image](blob:http://localhost/temporary-image) after");
    expect(canonicalizeAttachmentUrls(rendered, urls)).toBe(canonical);
  });
});
