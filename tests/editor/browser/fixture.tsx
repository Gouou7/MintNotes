import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { MarkdownEditor } from "../../../src/editor/MarkdownEditor";
import { ReadingEditor } from "../../../src/editor/ReadingEditor";
import { I18nProvider } from "../../../src/i18n";
import { NotePaneLayout } from "../../../src/features/vault/NotePaneLayout";
import { useNoteEditorIntegration } from "../../../src/features/vault/useNoteEditorIntegration";
import { buildOutline } from "../../../src/editor/outline";
import type { OpenDocument, WorkspaceEditorMode } from "../../../src/types";
import "../../../src/styles.css";
import "./fixture.css";
const sample = ['---', 'title: Example', 'enabled: true', 'count: 2', 'tags: [one, two]', '---', '# Heading', '', 'Text **bold** *italic* ~~strike~~ ==mark== H~2~O x^2^ :smile:', '', '$x^2$ [[Note#Heading|Alias]] [^one] ^[Inline footnote]', '', '> [!warning]- Warning', '> body without a blank line', '>','> > [!tip] Nested', '> > nested content', '', '[^one]: Footnote **body**', '', '%%hidden comment%%', '', '| A | B |', '| --- | --- |', '| cell | $x$ |', '', '```ts', 'const value: number = 1;', '```', '', '```mermaid', 'flowchart LR', ' A --> B', '```', '', '## End'].join('\n');
type Fixture = { load(text: string, key?: string): void; markdown(): string; saves(): number; resolveAttachment(): void; navigation(): string; notice(): string };
declare global { interface Window { mintFixture: Fixture } }
function App() {
  const [note, setNote] = useState('a'), [mode, setMode] = useState<WorkspaceEditorMode>('live'), [locked, setLocked] = useState(false), [preview, setPreview] = useState(false), [wrap, setWrap] = useState(true), [font, setFont] = useState(0), [notice, setNotice] = useState(''), [nav, setNav] = useState('');
  const [documents, setDocuments] = useState<Record<string, string>>({ a: sample, b: 'Other note' });
  const saves = useRef(0), release = useRef<(() => void) | undefined>(undefined), area = useRef<HTMLDivElement>(null);
  const markdown = documents[note];
  const doc = { objectId: note, markdown, locked, deleted: false, attachmentIds: [], kind: 'note' } as unknown as OpenDocument;
  const integration = useNoteEditorIntegration({ document: doc, previewing: preview,
    findDocument: id => documents[id] === undefined ? undefined : { ...doc, objectId: id, markdown: documents[id], locked: id === note && locked },
    patchDocument: (id, patch) => { saves.current++; setDocuments(current => ({ ...current, [id]: patch.markdown })); },
    saveImage: async () => { await new Promise<void>(resolve => { release.current = resolve; }); return '\n![saved](webmd-attachment:12345678-1234-1234-1234-123456789abc)\n'; },
  });
  window.mintFixture = {
    load: (text, key = note) => { setDocuments(current => ({ ...current, [key]: text })); setNote(key); }, markdown: () => markdown, saves: () => saves.current,
    resolveAttachment: () => release.current?.(), navigation: () => nav, notice: () => notice,
  };
  const toolbar = <header className="note-toolbar">
    {(['live', 'source', 'reading'] as const).map(value => <button key={value} onClick={() => setMode(value)}>{value}</button>)}
    <button onClick={() => setNote(current => current === 'a' ? 'b' : 'a')}>Switch note</button>
    <button onClick={() => setLocked(current => !current)}>Lock note</button>
    <button onClick={() => setPreview(current => !current)}>History preview</button>
    <button onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}>Theme</button>
    <button onClick={() => setFont(current => current === 0 ? 4 : 0)}>Font size</button>
    <button onClick={() => setWrap(current => !current)}>Code wrap</button>
  </header>;
  return <div className="fixture-workspace" style={{ '--font-adjust': `${font}px` } as React.CSSProperties}>
    <NotePaneLayout editorArea={area} toolbar={toolbar} historyBanner={preview ? <div className="history-preview-banner">History preview</div> : undefined} status={<footer className="status-bar">{notice || 'Ready'}</footer>}>
      {preview ? <ReadingEditor markdown={sample} /> : <MarkdownEditor documentKey={note} markdown={markdown} mode={locked ? 'reading' : mode} onModeChange={setMode} onChange={integration.onChange} onImageInsert={integration.onImageInsert} onInsertionCancelled={() => setNotice('Retry insertion')} onWikiLink={setNav} wrapCodeBlocks={wrap} />}
    </NotePaneLayout>
    <aside className="fixture-outline">{buildOutline(markdown).map(item => <button key={item.id} onClick={() => area.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')[item.index]?.scrollIntoView({ block: 'center' })}>{item.text}</button>)}</aside>
  </div>;
}
localStorage.setItem('webmd-notes-language', 'en');
createRoot(document.getElementById('root')!).render(<I18nProvider><App /></I18nProvider>);
