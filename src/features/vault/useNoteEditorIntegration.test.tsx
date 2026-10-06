import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useNoteEditorIntegration } from './useNoteEditorIntegration';
import type { OpenDocument } from '../../types';
vi.mock('../../crypto/client', () => ({ cryptoClient: {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });
async function setup() {
  const note = (id: string) => ({ objectId: id, markdown: id, attachmentIds: [], locked: false, deleted: false, kind: 'note' } as unknown as OpenDocument);
  const documents = new Map([['a', note('a')], ['b', note('b')]]);
  const patchDocument = vi.fn(), saveImage = vi.fn(async () => 'image');
  let document = documents.get('a')!, controller!: ReturnType<typeof useNoteEditorIntegration>;
  function Harness() { controller = useNoteEditorIntegration({ document, previewing: false, findDocument: id => documents.get(id), patchDocument, saveImage }); return null; }
  const host = documentWindow(); root = createRoot(host); await act(async () => root.render(<Harness />));
  return { documents, patchDocument, saveImage, get controller() { return controller; }, switch: async () => { document = documents.get('b')!; await act(async () => root.render(<Harness />)); } };
}
function documentWindow() { const host = window.document.createElement('div'); window.document.body.append(host); return host; }
it('routes delayed composition callbacks by document identity and refuses locked notes', async () => {
  const state = await setup(); await state.switch(); state.controller.onChange('edited a', 'a');
  expect(state.patchDocument).toHaveBeenCalledWith('a', { markdown: 'edited a', attachmentIds: [] });
  state.documents.get('a')!.locked = true; state.controller.onChange('blocked', 'a'); expect(state.patchDocument).toHaveBeenCalledTimes(1);
});
it('starts attachment persistence against the original note identity', async () => {
  const state = await setup(); const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const pending = state.controller.onImageInsert(file); await state.switch(); await pending;
  expect(state.saveImage).toHaveBeenCalledWith('a', file); state.documents.get('b')!.locked = true;
  expect(await state.controller.onImageInsert(file)).toBeNull(); expect(state.saveImage).toHaveBeenCalledTimes(1);
});
