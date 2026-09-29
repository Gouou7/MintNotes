import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDocument } from "../../types";
import { NameReservations } from "../siblingNames";
import { useImportExport } from "./useImportExport";
import { persistImportedDocument } from "./importPersistence";
vi.mock("../../crypto/client",()=>({cryptoClient:{}}));
vi.mock("./importPersistence",()=>({persistImportedDocument:vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;
afterEach(async()=>{if(root) await act(async()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks();vi.clearAllMocks();});
async function harness(readAttachment: Parameters<typeof useImportExport>[0]['readAttachment'] = async()=>new Blob()) {
  const documents:OpenDocument[]=[];
  const attachments: import('../../types').OpenAttachment[] = [];
  const publish=vi.fn((document:OpenDocument)=>{documents.push(document);});
  const onImported=vi.fn();const notify=vi.fn();const onResult=vi.fn();
  let controller!:ReturnType<typeof useImportExport>;
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  function Harness(){controller=useImportExport({userId:'user',getDocuments:()=>documents,getAttachments:()=>attachments,reservations:new NameReservations(),isActive:()=>true,readAttachment,publish,onImported,onResult,notify,t:(key)=>key});return null;}
  await act(async()=>root.render(<Harness/>));
  return {get controller(){return controller;},documents,attachments,publish,onImported,notify,onResult};
}
describe('import/export controller',()=>{
  it('publishes only committed notes and activates the first note once',async()=>{
    vi.mocked(persistImportedDocument).mockImplementation(async(_user,document)=>({document,attachments:[]}));
    const state=await harness();
    await act(async()=>state.controller.handleImport([new File(['one'],'note.md'),new File(['two'],'note.md')]));
    expect(state.documents.map((d)=>d.title)).toEqual(['note','note 2']);
    expect(state.onImported).toHaveBeenCalledExactlyOnceWith(state.documents[0].objectId);
    expect(state.controller.result?.completed).toHaveLength(2);
  });
  it('does not publish unfinished notes when persistence fails',async()=>{
    vi.mocked(persistImportedDocument).mockRejectedValueOnce(new Error('storage'));
    const state=await harness();
    await act(async()=>state.controller.handleImport([new File(['one'],'note.md')]));
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.controller.result?.failure?.code).toBe('writeFailed');
  });
  it('drains in-flight imports on lock and suppresses late plaintext UI updates',async()=>{
    let release!:()=>void;
    let entered!:()=>void;const ready=new Promise<void>((resolve)=>{entered=resolve;});
    vi.mocked(persistImportedDocument).mockImplementation(async(_user,document)=>{entered();await new Promise<void>((resolve)=>{release=resolve;});return {document,attachments:[]};});
    const state=await harness();
    let running!:Promise<void>;let cancelled!:Promise<void>;
    await act(async()=>{running=state.controller.handleImport([new File(['one'],'note.md')]);await ready;});
    await act(async()=>{cancelled=state.controller.cancel();release();await running;await cancelled;});
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.onImported).not.toHaveBeenCalled();
    expect(state.onResult).not.toHaveBeenCalled();
    expect(state.controller.result).toBeNull();
  });
  it('reports export failures instead of rejecting a UI event promise',async()=>{
    const state=await harness();
    state.documents.push({objectId:'1',kind:'note',title:'note',parentId:null,markdown:'![a](webmd-attachment:11111111-1111-4111-8111-111111111111)',deleted:false} as OpenDocument);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    await act(async()=>state.controller.exportRoot('1'));
    expect(state.notify).toHaveBeenCalledWith('transfer.exportFailed','critical');
  });
});

it('aborts an in-flight export download when locking and suppresses late failure notices', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let signal!: AbortSignal;
  const state = await harness(async (_attachment, _active, abortSignal) => {
    signal = abortSignal;
    started();
    return new Promise<Blob>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const id = '11111111-1111-4111-8111-111111111111';
  state.documents.push({objectId:'1',kind:'note',title:'note',parentId:null,markdown:`![a](webmd-attachment:${id})`,deleted:false} as OpenDocument);
  // The hook snapshot needs a manifest in order to start the remote read.
  // Use the returned mutable attachment list so the same controller remains mounted.
  state.attachments.push({objectId:id,mime:'image/png',ownerNoteId:'1',originalName:'a.png',deleted:false} as import('../../types').OpenAttachment);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let exporting!: Promise<void>;
  await act(async () => { exporting = state.controller.exportRoot('1'); await ready; });
  await act(async () => { await state.controller.cancel(); await exporting; });
  expect(signal.aborted).toBe(true);
  expect(state.notify).not.toHaveBeenCalled();
});
