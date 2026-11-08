import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { chooseSelect, openSelect } from "../../components/select.testSupport";
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
  return container.querySelector<HTMLElement>("[role=combobox]")!;
}
describe("quota capacity choices", () => {
  it("shows total presets without changing an existing inherited quota", async () => {
    const select = await render(quotaDraft("inherit", null));
    expect((await openSelect(select)).map(option => option.textContent)).toEqual(["Unlimited", "100MiB", "200MiB", "500MiB", "1GiB", "2GiB", "Custom"]);
    expect(select.textContent).toBe("2GiB");
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(quotaPayload(current)).toEqual({ mode: "inherit", bytes: null });
    await chooseSelect(select, "100MiB");
    expect(quotaPayload(current)).toEqual({ mode: "limited", bytes: 100 * 1048576 });
    await chooseSelect(select, "Unlimited");
    expect(quotaPayload(current)).toEqual({ mode: "unlimited", bytes: null });
  });
  it("preserves the existing history budget when it is not a preset", async () => {
    const select = await render(quotaDraft("limited", 256 * 1048576), true);
    expect((await openSelect(select)).map(option => option.textContent)).toEqual(["Unlimited", "100MiB", "200MiB", "500MiB", "Custom"]);
    expect(select.textContent).toBe("Custom");
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("256");
    expect(quotaPayload(current).bytes).toBe(256 * 1048576);
    await chooseSelect(select, "500MiB");
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(quotaPayload(current).bytes).toBe(500 * 1048576);
  });
  it("keeps the custom field open when an entered capacity matches a preset", async () => {
    const select = await render(quotaDraft("inherit", null));
    await chooseSelect(select, "Custom");
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.value).toBe("2048");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "200"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(select.textContent).toBe("Custom");
    expect(container.querySelector('input[type="number"]')).toBe(input);
    expect(quotaPayload(current)).toEqual({ mode: "limited", bytes: 200 * 1048576 });
    await chooseSelect(select, "1GiB");
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(quotaPayload(current).bytes).toBe(1024 * 1048576);
  });
});
