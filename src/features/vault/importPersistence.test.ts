import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDb } from "../../storage/database";
import { cryptoClient } from "../../crypto/client";
import { makeDocument } from "./documentFactory";
import { persistImportedDocument } from "./importPersistence";
import { markdownImages } from "../markdownImages";
import type { ImportNote } from "../importPlan";

vi.mock("../../crypto/client", () => ({ cryptoClient: { createAttachment: vi.fn(), encryptObject: vi.fn() } }));
const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function input(): ImportNote {
  const markdown='![a](a.png) ![b](a.png)';
  const image={key:'a.png',file:new File([png],'a.png')};
  return {source:'note.md',title:'note',parentKey:null,markdown,images:new Map(markdownImages(markdown).map((reference)=>[reference,image]))};
}
beforeEach(async () => {
  await localDb.delete();
  await localDb.open();
  vi.mocked(cryptoClient.encryptObject).mockResolvedValue({ciphertext:'encrypted',nonce:'nonce',encryptionVersion:2});
  vi.mocked(cryptoClient.createAttachment).mockImplementation(async (request) => ({
    metadata:{kind:'attachment',ownerNoteId:request.ownerNoteId,originalName:request.originalName,mime:request.mime,size:request.data.byteLength,sha256:'digest',chunkCount:1,chunkSize:request.chunkSize,attachmentKey:`key-${request.attachmentId}`,deleted:false,createdAt:'2026-09-29',updatedAt:'2026-09-29',schemaVersion:2},
    chunks:[{attachmentId:request.attachmentId,chunkIndex:0,totalChunks:1,ciphertext:new ArrayBuffer(8),nonce:'nonce',encryptionVersion:2}]
  }));
});
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); await localDb.delete(); });
async function counts() {
  return Promise.all([localDb.objects.count(),localDb.outbox.count(),localDb.attachmentChunks.count(),localDb.attachmentOutbox.count()]);
}
describe('atomic imported notes', () => {
  it('commits one attachment per note even for repeated image references', async () => {
    const note=input();
    const result=await persistImportedDocument('user',makeDocument([],'note','note',null,note.markdown),note,()=>true);
    expect(result.attachments).toHaveLength(1);
    expect(await counts()).toEqual([2,2,1,1]);
    expect(result.document.markdown.match(/webmd-attachment:/g)).toHaveLength(2);
    expect(result.document.attachmentIds).toEqual([result.attachments[0].objectId]);
  });
  it('creates independent identities and keys when another note uses the same image', async () => {
    const note=input();
    const first=await persistImportedDocument('user',makeDocument([],'note','first',null,note.markdown),note,()=>true);
    const second=await persistImportedDocument('user',makeDocument([],'note','second',null,note.markdown),note,()=>true);
    expect(first.attachments[0].objectId).not.toBe(second.attachments[0].objectId);
    expect(first.attachments[0].attachmentKey).not.toBe(second.attachments[0].attachmentKey);
  });
  it('writes nothing if note encryption fails after attachments are prepared', async () => {
    vi.mocked(cryptoClient.encryptObject).mockResolvedValueOnce({ciphertext:'encrypted',nonce:'nonce',encryptionVersion:2}).mockRejectedValueOnce(new Error('encryption failed'));
    const note=input();
    await expect(persistImportedDocument('user',makeDocument([],'note','note',null,note.markdown),note,()=>true)).rejects.toThrow('encryption failed');
    expect(await counts()).toEqual([0,0,0,0]);
  });
  it('rolls back chunks, manifests and the note when the final outbox write fails', async () => {
    vi.spyOn(localDb.outbox,'add').mockRejectedValueOnce(new Error('disk full'));
    const note=input();
    await expect(persistImportedDocument('user',makeDocument([],'note','note',null,note.markdown),note,()=>true)).rejects.toThrow('disk full');
    expect(await counts()).toEqual([0,0,0,0]);
  });
  it('rolls back if locking starts during the transaction', async () => {
    let active=true;
    const add=localDb.outbox.add.bind(localDb.outbox);
    vi.spyOn(localDb.outbox,'add').mockImplementation((...args) => add(...args).then((key) => { active=false; return key; }));
    const note=input();
    await expect(persistImportedDocument('user',makeDocument([],'note','note',null,note.markdown),note,()=>active)).rejects.toMatchObject({name:'AbortError'});
    expect(await counts()).toEqual([0,0,0,0]);
  });
  it('does not begin encryption after cancellation', async () => {
    await expect(persistImportedDocument('user',makeDocument([],'folder','folder',null),undefined,()=>false)).rejects.toMatchObject({name:'AbortError'});
    expect(cryptoClient.encryptObject).not.toHaveBeenCalled();
    expect(await counts()).toEqual([0,0,0,0]);
  });
});
