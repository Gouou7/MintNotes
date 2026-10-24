import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHistoryQuotaAutoSave } from "./useHistoryQuotaAutoSave";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let current: ReturnType<typeof useHistoryQuotaAutoSave>;
const update = vi.fn<(patch: { quotaBytes: number | null }) => Promise<boolean>>();
function Fixture({ bytes = 256 * 1048576, busy = false, online = true }) {
  current = useHistoryQuotaAutoSave(bytes, busy, online, update);
  return null;
}
async function render(bytes?: number, busy = false, online = true) {
  if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<Fixture bytes={bytes} busy={busy} online={online} />));
}
beforeEach(() => { vi.useFakeTimers(); update.mockResolvedValue(true); });
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("saves presets immediately without saving on mount or resubmitting on blur", async () => {
  await render();
  expect(update).not.toHaveBeenCalled();
  await act(async () => current.change({ mode: "limited", mib: "200" }));
  expect(update).toHaveBeenLastCalledWith({ quotaBytes: 200 * 1048576 });
  await act(async () => { await current.flush(); });
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => current.change({ mode: "unlimited", mib: "200" }));
  expect(update).toHaveBeenLastCalledWith({ quotaBytes: null });
});

it("debounces valid custom input, rejects incomplete values and keeps custom mode after acknowledgment", async () => {
  await render();
  for (const mib of ["", "-1", "1.5", "9007199254740991"]) {
    await act(async () => current.change({ mode: "limited", mib, custom: true }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
  }
  expect(update).not.toHaveBeenCalled();
  await act(async () => current.change({ mode: "limited", mib: "20", custom: true }));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => current.change({ mode: "limited", mib: "200", custom: true }));
  await act(async () => vi.advanceTimersByTimeAsync(499));
  expect(update).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(update).toHaveBeenCalledExactlyOnceWith({ quotaBytes: 200 * 1048576 });
  await render(200 * 1048576);
  expect(current.draft).toEqual({ mode: "limited", mib: "200", custom: true });
});

it("flushes on leaving the field, restores failed changes and waits while another setting saves", async () => {
  await render();
  update.mockResolvedValueOnce(false);
  await act(async () => current.change({ mode: "limited", mib: "300", custom: true }));
  await act(async () => { await current.flush(); });
  expect(current.draft.mib).toBe("256");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(update).toHaveBeenCalledTimes(1);
  await render(undefined, true);
  await act(async () => current.change({ mode: "limited", mib: "400", custom: true }));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(update).toHaveBeenCalledTimes(1);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(update).toHaveBeenLastCalledWith({ quotaBytes: 400 * 1048576 });
});

it("cancels pending saves when going offline or closing the section", async () => {
  await render();
  await act(async () => current.change({ mode: "limited", mib: "300", custom: true }));
  await render(undefined, false, false);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(update).not.toHaveBeenCalled();
  expect(current.draft.mib).toBe("256");
  await render();
  await act(async () => current.change({ mode: "limited", mib: "400", custom: true }));
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(update).not.toHaveBeenCalled();
});
