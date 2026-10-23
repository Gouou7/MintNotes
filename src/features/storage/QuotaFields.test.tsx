import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { HISTORY_QUOTA_PRESETS, QuotaFields, quotaDraft, quotaPayload, type QuotaDraft } from "./QuotaFields";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;
let current: QuotaDraft;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); });
async function render(initial: QuotaDraft, history = false, defaultBytes = 2 * 1024 * 1048576) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  function Fixture() {
    const [value, setValue] = useState(initial); current = value;
    return <QuotaFields label="Quota" value={value} onChange={setValue} defaultBytes={defaultBytes} presets={history ? HISTORY_QUOTA_PRESETS : undefined} />;
  }
  await act(async () => root!.render(<I18nProvider><Fixture /></I18nProvider>));
  return container.querySelector("select")!;
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
describe("quota capacity choices", () => {
  it("shows total presets without changing an existing inherited quota", async () => {
    const select = await render(quotaDraft("inherit", null));
    expect([...select.options].map(option => option.value)).toEqual(["unlimited", "100", "200", "500", "1024", "2048", "custom"]);
    expect(select.value).toBe("2048");
    expect(container.querySelector("input")).toBeNull();
    expect(quotaPayload(current)).toEqual({ mode: "inherit", bytes: null });
    await choose(select, "100");
    expect(quotaPayload(current)).toEqual({ mode: "limited", bytes: 100 * 1048576 });
    await choose(select, "unlimited");
    expect(quotaPayload(current)).toEqual({ mode: "unlimited", bytes: null });
  });
  it("preserves the existing history budget when it is not a preset", async () => {
    const select = await render(quotaDraft("limited", 256 * 1048576), true);
    expect([...select.options].map(option => option.value)).toEqual(["unlimited", "100", "200", "500", "custom"]);
    expect(select.value).toBe("custom");
    expect(container.querySelector("input")?.value).toBe("256");
    expect(quotaPayload(current).bytes).toBe(256 * 1048576);
    await choose(select, "500");
    expect(container.querySelector("input")).toBeNull();
    expect(quotaPayload(current).bytes).toBe(500 * 1048576);
  });
  it("keeps the custom field open when an entered capacity matches a preset", async () => {
    const select = await render(quotaDraft("inherit", null));
    await choose(select, "custom");
    const input = container.querySelector("input")!;
    expect(input.value).toBe("2048");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "200"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(select.value).toBe("custom");
    expect(container.querySelector("input")).toBe(input);
    expect(quotaPayload(current)).toEqual({ mode: "limited", bytes: 200 * 1048576 });
    await choose(select, "1024");
    expect(container.querySelector("input")).toBeNull();
    expect(quotaPayload(current).bytes).toBe(1024 * 1048576);
  });
});
