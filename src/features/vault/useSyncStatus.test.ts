import { describe, expect, it } from "vitest";
import { translateMessage, type Translate } from "../../i18n";
import {
  createSyncStatus,
  reduceSyncStatus,
  settledSyncPhase,
  syncStatusDetailText,
  visibleSyncStatusText,
  type SaveState,
  type VisibleSyncStatus
} from "./useSyncStatus";

const zh: Translate = (key, values) => translateMessage("zh-CN", key, values);

function phase(current: ReturnType<typeof createSyncStatus>, next: Exclude<SaveState, "error">) {
  return reduceSyncStatus(current, { type: "phase", phase: next });
}

describe("sync status presentation", () => {
  it("maps the internal save phases to four visible states", () => {
    const expected: Record<Exclude<SaveState, "saving" | "error">, VisibleSyncStatus> = {
      ready: "synced",
      local: "syncing",
      syncing: "syncing",
      synced: "synced",
      offline: "offline"
    };
    for (const [next, visible] of Object.entries(expected)) {
      expect(phase(createSyncStatus(true), next as Exclude<SaveState, "saving" | "error">).visible).toBe(visible);
    }
    expect(reduceSyncStatus(createSyncStatus(true), {
      type: "sync-error",
      failure: { kind: "unreachable" }
    }).visible).toBe("error");
  });

  it("keeps the previous visible state while the latest edit is saving locally", () => {
    for (const visible of ["synced", "syncing", "error", "offline"] as const) {
      const current = {
        ...createSyncStatus(true),
        phase: visible === "error" ? "error" as const : visible,
        visible
      };
      expect(phase(current, "saving").visible).toBe(visible);
    }
  });

  it("moves from durable local storage through synchronization to acknowledgement", () => {
    const saving = phase(createSyncStatus(true), "saving");
    const local = phase(saving, "local");
    const syncing = phase(local, "syncing");
    const synced = phase(syncing, "synced");
    expect([saving.visible, local.visible, syncing.visible, synced.visible]).toEqual([
      "synced",
      "syncing",
      "syncing",
      "synced"
    ]);
  });

  it("tracks local persistence failures separately from synchronization errors", () => {
    const failed = reduceSyncStatus(createSyncStatus(true), {
      type: "local-failure",
      objectId: "note-1"
    });
    expect(failed.failedLocalObjectIds.has("note-1")).toBe(true);
    expect(failed.visible).toBe("synced");

    const recovered = reduceSyncStatus(failed, {
      type: "local-success",
      objectId: "note-1"
    });
    expect(recovered.failedLocalObjectIds.size).toBe(0);
  });

  it("classifies browser offline separately from an unreachable online server", () => {
    const offline = phase(createSyncStatus(true), "offline");
    const unreachable = reduceSyncStatus(createSyncStatus(true), {
      type: "sync-error",
      failure: { kind: "unreachable" }
    });
    expect(offline.visible).toBe("offline");
    expect(unreachable.visible).toBe("error");
  });

  it("settles initial loading from connectivity and all-outbox pending count", () => {
    expect(settledSyncPhase(true, 0)).toBe("synced");
    expect(settledSyncPhase(true, 3)).toBe("local");
    expect(settledSyncPhase(false, 0)).toBe("offline");
    expect(settledSyncPhase(false, 3)).toBe("offline");
  });

  it("uses the four requested main labels and detailed failure tooltips", () => {
    expect(visibleSyncStatusText("synced", zh)).toBe("已同步");
    expect(visibleSyncStatusText("syncing", zh)).toBe("正在同步…");
    expect(visibleSyncStatusText("error", zh)).toBe("同步错误 · 已保存到本地");
    expect(visibleSyncStatusText("offline", zh)).toBe("离线 · 已保存到本地");

    const unreachable = reduceSyncStatus(createSyncStatus(true), {
      type: "sync-error",
      failure: { kind: "unreachable" }
    });
    expect(syncStatusDetailText(unreachable, zh)).toBe("无法连接服务器 · 修改已保存到本地，将自动重试");

    const rejected = reduceSyncStatus(createSyncStatus(true), {
      type: "sync-error",
      failure: { kind: "server", reason: "服务器繁忙" }
    });
    expect(syncStatusDetailText(rejected, zh)).toContain("服务器拒绝同步：服务器繁忙");
  });

  it("never describes a local persistence failure as saved locally", () => {
    const failed = reduceSyncStatus(createSyncStatus(true), {
      type: "local-failure",
      objectId: "note-1"
    });
    expect(syncStatusDetailText(failed, zh)).toBe("本地保存失败 · 最新修改尚未安全保存");
    expect(syncStatusDetailText(failed, zh)).not.toContain("已保存到本地");
  });
});
