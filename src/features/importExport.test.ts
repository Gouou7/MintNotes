import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { OpenDocument } from "../types";
import { importFiles, exportMarkdownZip } from "./importExport";
import { prepareImport, commitImport, type ImportHandlers } from "./importPlan";
import { uniqueSiblingTitle } from "./siblingNames";
import { rewriteMarkdownImages } from "./markdownImages";
vi.mock("../crypto/client", () => ({ cryptoClient: {} }));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function handlers() {
  const documents: OpenDocument[] = [];
  const create = (title: string, parentId: string | null, markdown: string, kind: "note" | "folder") => {
    const document = { objectId: String(documents.length + 1), title: uniqueSiblingTitle(documents, title, parentId), parentId, markdown, kind, deleted: false } as OpenDocument;
    documents.push(document);
    return { objectId: document.objectId, title: document.title };
  };
  const api: ImportHandlers = {
    createFolder: vi.fn(async (title, parentId) => create(title, parentId, "", "folder")),
    createNote: vi.fn(async (note, parentId) => create(note.title, parentId, note.markdown, "note"))
  };
  return { api, documents };
}
async function archive(entries: Record<string, string | Uint8Array | null>, name = "test.zip") {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    if (content === null) zip.folder(path); else zip.file(path, content);
  }
  return new File([Uint8Array.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))], name);
}
async function duplicateArchive() {
  const file = await archive({ 'a.md': 'first', 'b.md': 'second' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const needle = new TextEncoder().encode('b.md');
  for (let i = 0; i <= bytes.length - needle.length; i++) if (needle.every((byte, offset) => byte === bytes[i + offset])) bytes[i] = 97;
  return new File([bytes], 'duplicate.zip');
}
afterEach(() => vi.restoreAllMocks());

describe("Markdown and ZIP import", () => {
  it("preserves standalone duplicates, extension collisions and Unicode-equivalent names", async () => {
    const { api, documents } = handlers();
    const result = await importFiles([new File(['first'], 'Note.md'), new File(['second'], 'note.md'), new File(['third'], 'note.txt'), new File(['4'], 'é.md'), new File(['5'], 'e\u0301.md')], api);
    expect(result.completed).toHaveLength(5);
    expect(documents.map((d) => d.title)).toEqual(['Note', 'note 2', 'note 3', 'é', 'e\u0301 2']);
    expect(documents.map((d) => d.markdown)).toEqual(['first','second','third','4','5']);
  });
  it("preserves exact duplicate central directory entries", async () => {
    const { api, documents } = handlers();
    const result = await importFiles([await duplicateArchive()], api);
    expect(result.completed).toHaveLength(2);
    expect(documents.map((d) => [d.title, d.markdown])).toEqual([['a','first'],['a 2','second']]);
  });
  it("keeps folders in different archives separate and preserves empty directories", async () => {
    const { api, documents } = handlers();
    await importFiles([await archive({'folder/a.md':'one','empty':null}, 'one.zip'), await archive({'folder/a.md':'two'}, 'two.zip')], api);
    const folders = documents.filter((d) => d.kind === 'folder');
    expect(folders.map((d) => d.title)).toEqual(['folder','empty','folder 2']);
    expect(documents.filter((d) => d.kind === 'note').map((d) => d.parentId)).toEqual([folders[0].objectId,folders[2].objectId]);
  });
  it.each(['../a.md','/a.md','C:/a.md','..\\a.md','a/../b.md','a\0.md'])("rejects unsafe raw paths before writing: %s", async (path) => {
    const { api } = handlers();
    await expect(importFiles([await archive({[path]:'bad'})], api)).rejects.toBeDefined();
    expect(api.createNote).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
  });
  it("normalizes benign separators and dot segments", async () => {
    const { api, documents } = handlers();
    await importFiles([await archive({'a\\b.md':'one','a/./c.md':'two'})], api);
    expect(documents.filter((d) => d.kind === 'note').map((d) => d.title)).toEqual(['b','c']);
  });
  it("keeps missing, ambiguous, invalid and malformed image references with warnings", async () => {
    const markdown = '![missing](missing.png) ![ambiguous](A.png) ![invalid](bad.svg) ![escape](100%.png)';
    const plan = await prepareImport([await archive({'a.md':markdown,'a.png':png,'A.png':png,'bad.svg':'<svg />'})]);
    expect(plan.notes[0].markdown).toBe(markdown);
    expect(plan.notes[0].images.size).toBe(0);
    expect(plan.warnings.map((w) => w.code)).toEqual(['missingImage','ambiguousImage','invalidImage','invalidUrl']);
  });
  it("only resolves images inside the owning archive and deduplicates image preparation", async () => {
    const plan = await prepareImport([await archive({'a.md':'![a](a.png) ![b](a.png)','a.png':png}), await archive({'b.md':'![a](a.png)'},'two.zip')]);
    const prepared = [...plan.notes[0].images.values()];
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toBe(prepared[1]);
    expect(plan.warnings).toEqual([expect.objectContaining({ code:'missingImage',source:'two.zip/b.md' })]);
  });
  it("validates all manifests before any workspace write", async () => {
    const { api } = handlers();
    await expect(importFiles([new File(['valid'], 'first.md'), await archive({'a.md':'bad','_export.json':'{}'})], api)).rejects.toMatchObject({issue:{code:'manifestInvalid'}});
    expect(api.createNote).not.toHaveBeenCalled();
  });
  it("reports partial commits and stops after a persistence failure", async () => {
    const { api } = handlers();
    vi.mocked(api.createNote).mockResolvedValueOnce({objectId:'1',title:'a'}).mockRejectedValueOnce(new Error('storage full'));
    const result = await importFiles(['a','b','c'].map((name) => new File([name],`${name}.md`)), api);
    expect(result.completed).toHaveLength(1);
    expect(result.failure).toEqual({source:'b.md',code:'writeFailed'});
    expect(result.pending).toEqual(['b.md','c.md']);
    expect(api.createNote).toHaveBeenCalledTimes(2);
  });
  it("does not submit a prepared batch after cancellation", async () => {
    const plan = await prepareImport([new File(['a'],'a.md')]);
    const { api } = handlers();
    const result = await commitImport(plan,{...api,isActive:()=>false});
    expect(api.createNote).not.toHaveBeenCalled();
    expect(result.failure?.code).toBe('cancelled');
  });
  it("enforces a combined file count including standalone inputs", async () => {
    const { api } = handlers();
    const files = Array.from({length:4001},(_,i) => new File(['x'],`${i}.md`));
    await expect(importFiles(files,api)).rejects.toMatchObject({issue:{code:'fileLimit'}});
    expect(api.createNote).not.toHaveBeenCalled();
  });
  it("imports standalone Markdown larger than the attachment limit", async () => {
    const markdown = '# Large note\n' + 'a'.repeat(25 * 1024 * 1024);
    const { api, documents } = handlers();
    await importFiles([new File([markdown],'large.md')],api);
    expect(documents[0].markdown).toBe(markdown);
  },30_000);
});

describe('portable export', () => {
  function doc(objectId: string, title: string, kind: 'folder'|'note', parentId: string|null = null, markdown = objectId) {
    return {objectId,title,kind,parentId,markdown,deleted:false} as OpenDocument;
  }
  async function exported(documents: OpenDocument[]) {
    let output!: Blob;
    vi.spyOn(URL,'createObjectURL').mockImplementation((blob) => {output=blob as Blob; return 'blob:audit';});
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    await exportMarkdownZip(documents,[],async()=>new Blob());
    return JSZip.loadAsync(output);
  }
  it('allocates directories, files, generated suffixes and reserved names together', async () => {
    const zip = await exported([doc('1','a?','folder'),doc('2','a*','folder'),doc('3','a_ (2)','folder'),doc('4','first','note','2'),doc('5','second','note','3'),doc('6','_attachments','folder'),doc('7','report.md','folder'),doc('8','report','note')]);
    expect(zip.file('a_ (3)/first.md')).not.toBeNull();
    expect(zip.file('a_ (2)/second.md')).not.toBeNull();
    expect(zip.files['_attachments (2)/']).toBeDefined();
    expect(zip.files['report.md/']).toBeDefined();
    expect(zip.file('report (2).md')).not.toBeNull();
  });
  it('round trips empty folders, note bodies and Unicode names', async () => {
    const documents = [doc('1','项目','folder'),doc('2','empty','folder','1'),doc('3','é','note','1','text\r\n`code`\r\n')];
    const zip = await exported(documents);
    const {api,documents: restored}=handlers();
    await importFiles([new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'}))],'roundtrip.zip')],api);
    expect(restored.filter((d)=>d.kind==='folder').map((d)=>d.title)).toEqual(['项目','empty']);
    expect(restored.find((d)=>d.kind==='note')?.markdown).toBe('text\r\n`code`\r\n');
  });
  it('does not treat attachment strings in code as image references', async () => {
    const source='`webmd-attachment:11111111-1111-4111-8111-111111111111`';
    const zip=await exported([doc('1','note','note',null,source)]);
    expect(await zip.file('note.md')!.async('string')).toBe(source);
  });
  it('preserves source outside real image destinations during import rewrite', async () => {
    const source='plain a.png data.png `a.png` ![image](a.png)';
    const plan=await prepareImport([await archive({'a.md':source,'a.png':png})]);
    const note=plan.notes[0];
    const rewritten=rewriteMarkdownImages(note.markdown,new Map([...note.images.keys()].map((image)=>[image,'webmd-attachment:id'])));
    expect(rewritten).toBe('plain a.png data.png `a.png` ![image](<webmd-attachment:id>)');
  });
});

it('warns about oversized images without imposing the attachment limit on the archive', async () => {
  const image=new Uint8Array(25*1024*1024+1); image.set(png);
  const plan=await prepareImport([await archive({'note.md':'![large](large.png)','large.png':image,'unrelated.bin':image})]);
  expect(plan.notes).toHaveLength(1);
  expect(plan.notes[0].images.size).toBe(0);
  expect(plan.warnings.map((warning)=>warning.code)).toEqual(['largeImage']);
},30_000);

it('round trips attachment bytes and preserves original image filenames', async () => {
  const id='11111111-1111-4111-8111-111111111111';
  const attachment={objectId:id,ownerNoteId:'note',mime:'image/png',originalName:'原图.png',deleted:false} as import('../types').OpenAttachment;
  const documents=[{objectId:'folder',kind:'folder',title:'folder',parentId:null,markdown:'',deleted:false},{objectId:'note',kind:'note',title:'note',parentId:'folder',markdown:`text\r\n![a](webmd-attachment:${id}) ![b](webmd-attachment:${id})\r\n`,deleted:false}] as OpenDocument[];
  let output!:Blob;
  vi.spyOn(URL,'createObjectURL').mockImplementation((blob)=>{output=blob as Blob;return 'blob:roundtrip';});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const read=vi.fn(async()=>new Blob([png]));
  await exportMarkdownZip(documents,[attachment],read);
  expect(read).toHaveBeenCalledTimes(1);
  const plan=await prepareImport([new File([output],'roundtrip.zip')]);
  expect(plan.warnings).toEqual([]);
  expect(plan.folders.map((folder)=>folder.title)).toEqual(['folder']);
  const images=[...plan.notes[0].images.values()];
  expect(images).toHaveLength(2);
  expect(images[0]).toBe(images[1]);
  expect(images[0].file.name).toBe('原图.png');
  expect(new Uint8Array(await images[0].file.arrayBuffer())).toEqual(png);
});
