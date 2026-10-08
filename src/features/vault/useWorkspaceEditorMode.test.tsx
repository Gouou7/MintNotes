import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { OpenDocument, UiPreferences } from "../../types";
import { DEFAULT_DEVICE_WORKSPACE_PREFERENCES } from "../workspace";
import { useWorkspaceEditorMode } from "./useWorkspaceEditorMode";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function setup(editorReadOnly = false) {
  let document = { objectId: "a", kind: "note", locked: false } as OpenDocument;
  let previewing = false, controller!: ReturnType<typeof useWorkspaceEditorMode>, preferences!: UiPreferences;
  function Harness() {
    const [state, setState] = useState({ ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES, editorReadOnly } as UiPreferences);
    preferences = state; controller = useWorkspaceEditorMode({ document, previewing, preferences: state, onPreferences: setState }); return null;
  }
  const host = window.document.createElement("div"); window.document.body.append(host); root = createRoot(host);
  const render = async () => act(async () => root!.render(<Harness />)); await render();
  return { get controller() { return controller; }, get preferences() { return preferences; },
    switch: async (id: string, locked = false) => { document = { ...document, objectId: id, locked }; await render(); },
    preview: async () => { previewing = true; await render(); } };
}
it("keeps both device switches through note changes, protection and keyboard notifications", async () => {
  const state = await setup();
  await act(async () => state.controller.toggleReadOnly());
  await act(async () => state.controller.toggleSource());
  expect(state.controller).toMatchObject({ sourceMode: true, readOnlyMode: true, readOnly: true, effectiveMode: "source" });
  expect(state.preferences).toMatchObject({ editorMode: "source", editorReadOnly: true });
  await state.switch("b", true);
  await act(async () => state.controller.toggleReadOnly());
  expect(state.preferences.editorReadOnly).toBe(true);
  await act(async () => state.controller.toggleSource());
  expect(state.controller.effectiveMode).toBe("reading");
  await act(async () => state.controller.onModeChange("reading"));
  await state.switch("c");
  expect(state.controller).toMatchObject({ sourceMode: false, readOnlyMode: true, effectiveMode: "reading" });
  await act(async () => state.controller.onModeChange("source"));
  expect(state.preferences).toMatchObject({ editorMode: "source", editorReadOnly: true });
  await act(async () => state.controller.toggleReadOnly());
  expect(state.controller).toMatchObject({ sourceMode: true, readOnly: false, effectiveMode: "source" });
});
it("does not turn forced protection into a device read-only preference", async () => {
  const state = await setup(); await state.switch("protected", true);
  expect(state.controller.readOnly).toBe(true); expect(state.preferences.editorReadOnly).toBe(false);
  await act(async () => state.controller.toggleSource());
  await state.switch("editable");
  expect(state.controller).toMatchObject({ sourceMode: true, readOnly: false, effectiveMode: "source" });
  await state.preview();
  await act(async () => { state.controller.toggleSource(); state.controller.toggleReadOnly(); });
  expect(state.preferences).toMatchObject({ editorMode: "source", editorReadOnly: false });
});
