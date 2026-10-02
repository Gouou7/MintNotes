import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "./core/lib";
import { IMAGE_RECONNECT_RETRY_INTERVAL_MS } from "./core/image-reconnect-retry";

function mockImageLoads() {
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
  return { probes, requests };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    const { probes, requests } = mockImageLoads();
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

  it("retries only failed external images and preserves source, selection and save callbacks", () => {
    const { probes, requests } = mockImageLoads();
    const attachment = "webmd-attachment:11111111-1111-4111-8111-111111111111";
    const source = `before\r\n\r\n![failed](https://images.example.test/failed.png)\r\n\r\n![loaded](https://images.example.test/loaded.png)\r\n\r\n![local](${attachment})\r\n\r\nafter`;
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const editor = createEditor(host, {
      initialContent: source, onChange,
      resolveImageSource: (url) => url === attachment ? "blob:http://localhost/attachment" : undefined
    });
    try {
      editor.setSelectionOffset(source.length);
      probes[0].dispatchEvent(new Event("error"));
      probes[1].dispatchEvent(new Event("load"));
      probes[2].dispatchEvent(new Event("error"));
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      window.dispatchEvent(new Event("online"));

      expect(requests.slice(3)).toEqual([{ src: "https://images.example.test/failed.png", referrerPolicy: "no-referrer" }]);
      probes[3].dispatchEvent(new Event("load"));
      window.dispatchEvent(new Event("online"));
      expect(requests).toHaveLength(4);
      expect(host.querySelector('img[src="https://images.example.test/failed.png"]')).not.toBeNull();
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelectionOffset()).toBe(source.length);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });

  it("coalesces repeated reconnect signals and does not poll after another failure", () => {
    vi.useFakeTimers();
    const { probes, requests } = mockImageLoads();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "![photo](https://images.example.test/retry.png)" });
    try {
      probes[0].dispatchEvent(new Event("error"));
      window.dispatchEvent(new Event("online"));
      probes[1].dispatchEvent(new Event("error"));
      for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("online"));
      expect(requests).toHaveLength(2);
      vi.advanceTimersByTime(IMAGE_RECONNECT_RETRY_INTERVAL_MS - 1);
      expect(requests).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(requests).toHaveLength(3);
      probes[2].dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(60_000);
      expect(requests).toHaveLength(3);
    } finally {
      editor.destroy();
    }
  });

  it.each(["replace", "hide", "destroy"])("drops queued retries when the current surface is %s", (operation) => {
    vi.useFakeTimers();
    const { probes, requests } = mockImageLoads();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "![old](https://images.example.test/old.png)" });
    let destroyed = false;
    try {
      probes[0].dispatchEvent(new Event("error"));
      window.dispatchEvent(new Event("online"));
      probes[1].dispatchEvent(new Event("error"));
      window.dispatchEvent(new Event("online"));
      if (operation === "replace") editor.setMarkdown("![new](https://images.example.test/new.png)");
      if (operation === "hide") editor.setSourceMode(true);
      if (operation === "destroy") { editor.destroy(); destroyed = true; }
      const count = requests.length;
      vi.advanceTimersByTime(IMAGE_RECONNECT_RETRY_INTERVAL_MS);
      window.dispatchEvent(new Event("online"));
      expect(requests).toHaveLength(count);
    } finally {
      if (!destroyed) editor.destroy();
    }
  });

  it("tracks a rendered image failure after a successful probe", () => {
    const { probes, requests } = mockImageLoads();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "![photo](https://images.example.test/rendered.png)" });
    try {
      probes[0].dispatchEvent(new Event("load"));
      host.querySelector("img.image-render")!.dispatchEvent(new Event("error"));
      expect(host.querySelector(".image-icon.broken")).not.toBeNull();
      window.dispatchEvent(new Event("online"));
      expect(requests).toHaveLength(2);
      probes[1].dispatchEvent(new Event("load"));
      expect(host.querySelector(".image-icon.broken")).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("ignores an earlier probe result after the rendered image has failed and retried", () => {
    const { probes } = mockImageLoads();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "![photo](https://images.example.test/stale.png)" });
    try {
      const staleLoad = probes[0].onload!;
      host.querySelector("img.image-render")!.dispatchEvent(new Event("error"));
      window.dispatchEvent(new Event("online"));
      probes[1].dispatchEvent(new Event("error"));
      staleLoad.call(probes[0], new Event("load"));
      expect(host.querySelector(".image-icon.broken")).not.toBeNull();
      expect(host.querySelector("img.image-render")).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
