import { describe, expect, it, vi } from "vitest";
import type { OpenAttachment } from "../types";
import { AttachmentCloneService } from "./attachmentClone";

function attachment(objectId: string, ownerNoteId = "source-note"): OpenAttachment {
  return {
    objectId,
    kind: "attachment",
    ownerNoteId,
    originalName: `${objectId}.png`,
    mime: "image/png",
    size: 8,
    chunkSize: 8,
    chunkCount: 1,
    sha256: "digest",
    attachmentKey: "key",
    deleted: false,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    schemaVersion: 2,
    serverRevision: 0,
    dirty: true
  };
}

describe("AttachmentCloneService", () => {
  it("clones the union of manifest and Markdown references with new ownership", async () => {
    const attachmentA = "00000000-0000-4000-8000-00000000000a";
    const attachmentB = "00000000-0000-4000-8000-00000000000b";
    const sources = new Map([
      [attachmentA, attachment(attachmentA)],
      [attachmentB, attachment(attachmentB)]
    ]);
    let sequence = 0;
    const service = new AttachmentCloneService({
      resolveAttachment: (id) => sources.get(id),
      readAttachment: async () => new Blob(["image"], { type: "image/png" }),
      createAttachment: async (ownerNoteId, source) => ({
        ...source,
        objectId: `copy-${++sequence}`,
        ownerNoteId,
        attachmentKey: `copy-key-${sequence}`
      }),
      persistAttachment: async (value) => value,
      removeAttachment: async () => undefined
    });

    const result = await service.clone({
      sourceMarkdown: `![a](webmd-attachment:${attachmentA})`,
      sourceAttachmentIds: [attachmentB],
      targetNoteId: "target-note"
    });

    expect(result.attachmentIds).toEqual(["copy-1", "copy-2"]);
    expect(result.attachments.every((value) => value.ownerNoteId === "target-note")).toBe(true);
    expect(result.attachments.map((value) => value.attachmentKey)).toEqual(["copy-key-1", "copy-key-2"]);
    expect(result.markdown).toBe("![a](webmd-attachment:copy-2)");
  });

  it("does not create targets when any source cannot be recovered", async () => {
    const attachmentA = "00000000-0000-4000-8000-00000000000a";
    const attachmentB = "00000000-0000-4000-8000-00000000000b";
    const createAttachment = vi.fn();
    const service = new AttachmentCloneService({
      resolveAttachment: (id) => id === attachmentA ? attachment(id) : undefined,
      readAttachment: async () => new Blob(["image"]),
      createAttachment,
      persistAttachment: async (value) => value,
      removeAttachment: async () => undefined
    });

    await expect(service.clone({
      sourceMarkdown: `webmd-attachment:${attachmentB}`,
      sourceAttachmentIds: [attachmentA],
      targetNoteId: "target-note"
    })).rejects.toThrow(attachmentB);
    expect(createAttachment).not.toHaveBeenCalled();
  });

  it("removes targets created before a later persistence failure", async () => {
    const removed: string[] = [];
    let sequence = 0;
    const service = new AttachmentCloneService({
      resolveAttachment: (id) => attachment(id),
      readAttachment: async () => new Blob(["image"]),
      createAttachment: async (ownerNoteId, source) => ({
        ...source,
        objectId: `copy-${++sequence}`,
        ownerNoteId
      }),
      persistAttachment: async (value) => {
        if (value.objectId === "copy-2") throw new Error("persist failed");
        return value;
      },
      removeAttachment: async (id) => { removed.push(id); }
    });

    await expect(service.clone({
      sourceMarkdown: "",
      sourceAttachmentIds: ["attachment-a", "attachment-b"],
      targetNoteId: "target-note"
    })).rejects.toThrow("persist failed");
    expect(removed.sort()).toEqual(["copy-1", "copy-2"]);
  });
});
