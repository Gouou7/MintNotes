import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVaultDerivedView } from "./useVaultDerivedView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  globalThis.document.body.replaceChildren();
});

describe("useVaultDerivedView", () => {
  it("settles expensive note statistics after typing but switches documents immediately", async () => {
    vi.useFakeTimers();
    const host = globalThis.document.createElement("div");
    globalThis.document.body.append(host);
    const root = createRoot(host);
    function Harness({ documentKey, markdown }: { documentKey: string; markdown: string }) {
      const derived = useVaultDerivedView({
        documents: [],
        documentKey,
        markdown,
        search: "",
        expanded: new Set(),
        sortMode: "manual"
      });
      return <span>{derived.statistics.words}:{derived.statistics.characters}</span>;
    }

    await act(async () => root.render(<Harness documentKey="first" markdown="one" />));
    expect(host.textContent).toBe("1:3");
    await act(async () => root.render(<Harness documentKey="first" markdown="one two three" />));
    expect(host.textContent).toBe("1:3");
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(host.textContent).toBe("3:11");
    await act(async () => root.render(<Harness documentKey="second" markdown="new note" />));
    expect(host.textContent).toBe("2:7");
    await act(async () => root.unmount());
  });
});
