import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "./core/lib";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("external image presentation", () => {
  it("does not probe external image URLs written inside code or Front Matter", () => {
    const requests: string[] = [];
    vi.stubGlobal("Image", class {
      constructor() {
        const probe = document.createElement("img");
        Object.defineProperty(probe, "src", { set(src: string) { requests.push(src); } });
        return probe;
      }
    });
    const source = [
      '---', 'example: "![metadata](https://images.example.test/metadata.png)"', '---', '',
      '`![inline code](https://images.example.test/inline-code.png)`', '',
      '```md', '![fenced code](https://images.example.test/fenced-code.png)', '```', '',
      '![photo](https://images.example.test/photo.png)'
    ].join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: source });
    try {
      expect([...host.querySelectorAll("img.image-render")].map((image) => image.getAttribute("src")))
        .toEqual(["https://images.example.test/photo.png"]);
      expect(requests).toEqual(["https://images.example.test/photo.png"]);
      expect(editor.getMarkdown()).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  it.each(["load", "error"])("keeps source and selection unchanged after an external image %s", (event) => {
    const probes: HTMLImageElement[] = [];
    const requests: { src: string; referrerPolicy: string }[] = [];
    vi.stubGlobal("Image", class {
      constructor() {
        const probe = document.createElement("img");
        Object.defineProperty(probe, "src", {
          set(src: string) { requests.push({ src, referrerPolicy: probe.referrerPolicy }); }
        });
        probes.push(probe);
        return probe;
      }
    });
    const source = `before\r\n\r\n![photo](https://images.example.test/${event}.png "Title")\r\n\r\nafter`;
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const editor = createEditor(host, { initialContent: source, onChange });
    try {
      editor.setSelectionOffset(source.length);
      const image = host.querySelector<HTMLImageElement>("img.image-render");
      expect(image?.getAttribute("src")).toBe(`https://images.example.test/${event}.png`);
      expect(image?.referrerPolicy).toBe("no-referrer");
      expect(image?.alt).toBe("photo");
      expect(image?.title).toBe("Title");
      expect(requests).toEqual([{ src: `https://images.example.test/${event}.png`, referrerPolicy: "no-referrer" }]);

      probes[0].dispatchEvent(new Event(event));
      if (event === "error") expect(host.querySelector(".image-icon.broken")).not.toBeNull();
      editor.setSourceMode(true);
      editor.setSourceMode(false);
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelectionOffset()).toBe(source.length);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
});
