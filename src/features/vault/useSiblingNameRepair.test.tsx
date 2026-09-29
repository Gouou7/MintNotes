import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSiblingNameRepair } from "./useSiblingNameRepair";
import { makeDocument } from "./documentFactory";
import type { OpenDocument } from "../../types";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;
afterEach(async()=>{if(root) await act(async()=>root.unmount());document.body.replaceChildren();});
it('queues repairs from current memory, preserves locked content, and stops once unique',async()=>{
  let documents=[{...makeDocument([],'note','Note',null,'older'),objectId:'a'},{...makeDocument([],'note','NOTE',null,'latest edit'),objectId:'b',locked:true}];
  const queueDocument=vi.fn((next:OpenDocument)=>{documents=documents.map((d)=>d.objectId===next.objectId?next:d);});
  const onRepair=vi.fn();
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  function Harness(){useSiblingNameRepair({documents,enabled:true,getDocuments:()=>documents,queueDocument,onRepair});return null;}
  await act(async()=>root.render(<Harness/>));
  expect(queueDocument).toHaveBeenCalledWith(expect.objectContaining({objectId:'b',title:'NOTE 2',markdown:'latest edit',locked:true}),0);
  expect(onRepair).toHaveBeenCalledExactlyOnceWith(1);
  await act(async()=>root.render(<Harness/>));
  expect(queueDocument).toHaveBeenCalledTimes(1);
});
