import { describe, expect, it } from "vitest";
import { nameKey, NameReservations, siblingNameRepairs, siblingTitleExists, uniqueSiblingTitle } from "./siblingNames";
import { makeDocument } from "./vault/documentFactory";
function doc(id: string, title: string, parentId: string | null = null) {
  return {...makeDocument([], 'note', title, parentId, 'body'), objectId:id};
}
describe('sibling names', () => {
  it('uses NFC and locale-independent lowercase without compatibility folding', () => {
    expect(nameKey(' É ')).toBe(nameKey('e\u0301'));
    expect(nameKey('Ａ')).not.toBe(nameKey('A'));
    expect(nameKey('后')).not.toBe(nameKey('後'));
    expect(siblingTitleExists([doc('1','Report')], 'report',null)).toBe(true);
    expect(uniqueSiblingTitle([doc('1','Report'),doc('2','report 2')],'REPORT',null)).toBe('REPORT 3');
  });
  it('reserves all existing names and ignores deleted objects and other folders', () => {
    const documents=[doc('z','note'),doc('a','Note'),doc('b','note 2'),{...doc('c','NOTE 3'),deleted:true},doc('d','note','other')];
    expect(siblingNameRepairs(documents)).toEqual([{objectId:'z',previousTitle:'note',title:'note 3'}]);
  });
  it('is deterministic across device order and idempotent after merge, including locked notes', () => {
    const documents=[{...doc('c','é'),locked:true},doc('a','e\u0301'),doc('b','É'),doc('d','é 2')];
    const repair=(items: typeof documents) => {
      const changes=new Map(siblingNameRepairs(items).map((change)=>[change.objectId,change.title]));
      return items.map((item)=>({...item,title:changes.get(item.objectId)??item.title})).sort((a,b)=>a.objectId.localeCompare(b.objectId));
    };
    const first=repair(documents);
    const second=repair([...documents].reverse());
    expect(first).toEqual(second);
    expect(siblingNameRepairs(first)).toEqual([]);
    expect(first.find((d)=>d.objectId==='c')).toMatchObject({markdown:'body',locked:true});
    expect(repair(first)).toEqual(first);
  });
  it('reserves unpublished copies and imports until publication or failure', () => {
    const reservations=new NameReservations();
    expect(reservations.reserve([],doc('1','note')).title).toBe('note');
    expect(reservations.reserve([],doc('2','NOTE')).title).toBe('NOTE 2');
    reservations.release('1');
    expect(reservations.reserve([],doc('3','Note')).title).toBe('Note');
  });
});

it('rejects conflicting manual batches and reserves destinations during persistence', () => {
  const reservations = new NameReservations();
  const first = doc('first', 'Same', 'folder-a');
  const second = doc('second', 'same', 'folder-b');
  const documents = [first, second];
  expect(reservations.claim(documents, [{...first, parentId:null}, {...second, parentId:null}])?.objectId).toBe('second');
  expect(reservations.documents()).toEqual([]);
  expect(reservations.claim(documents, [{...first, parentId:null}])).toBeUndefined();
  expect(reservations.claim(documents, [{...second, parentId:null}])?.objectId).toBe('second');
  expect(reservations.reserve(documents, doc('import', 'SAME')).title).toBe('SAME 2');
});
