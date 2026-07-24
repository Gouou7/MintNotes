import { describe, expect, it, vi } from "vitest";
import type { ImportHandlers } from "./importExport";

const { loadAsync } = vi.hoisted(() => ({ loadAsync: vi.fn() }));

vi.mock("jszip", () => ({
  default: { loadAsync }
}));
vi.mock("../crypto/client", () => ({ cryptoClient: {} }));

import { importFiles } from "./importExport";

function handlers(): ImportHandlers {
  return {
    createFolder: vi.fn(async () => "folder-id"),
    createNote: vi.fn(async () => "note-id"),
    attachImage: vi.fn(async () => "attachment-id"),
    updateNote: vi.fn(async () => undefined)
  };
}

describe("Markdown and ZIP import", () => {
  it("does not apply attachment-size limits to the archive or its expanded data", async () => {
    const note = new TextEncoder().encode("# Imported");
    const largeExpandedEntry = { byteLength: 300 * 1024 * 1024 } as Uint8Array;
    loadAsync.mockResolvedValueOnce({
      files: {
        "note.md": { dir: false, async: vi.fn(async () => note) },
        "archive-data.bin": { dir: false, async: vi.fn(async () => largeExpandedEntry) }
      }
    });
    const archive = new File(["zip"], "notes.zip", { type: "application/zip" });
    Object.defineProperty(archive, "size", { value: 100 * 1024 * 1024 });
    const importHandlers = handlers();

    await expect(importFiles([archive], importHandlers)).resolves.toBe(1);
    expect(importHandlers.createNote).toHaveBeenCalledWith("note", "# Imported", null);
  });

  it("imports standalone Markdown larger than the attachment limit", async () => {
    const markdown = `# Large note\n${"a".repeat(25 * 1024 * 1024)}`;
    const file = new File([markdown], "large.md", { type: "text/markdown" });
    const importHandlers = handlers();

    await expect(importFiles([file], importHandlers)).resolves.toBe(1);
    expect(importHandlers.createNote).toHaveBeenCalledWith("large", markdown, null);
  }, 30_000);
});
