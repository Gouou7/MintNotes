import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { revealScrollRect } from "../editor/product/viewport";
import { buildOutlineTree, type OutlineNode } from "../features/outlineTree";
import { useI18n } from "../i18n";
import type { OutlineItem } from "../types";
import { AppIcon } from "./AppIcon";

interface OutlineLevelProps {
  nodes: OutlineNode[];
  collapsed: ReadonlySet<string>;
  activePath: readonly string[];
  groupPrefix: string;
  onToggle: (key: string) => void;
  onSelect: (node: OutlineNode) => void;
}

const EMPTY_PATH: readonly string[] = [];

function OutlineLevel({ nodes, ...props }: OutlineLevelProps) {
  return <>{nodes.map(node => <OutlineBranch {...props} node={node} key={node.key}
    activePath={props.activePath[0] === node.key ? props.activePath : EMPTY_PATH} />)}</>;
}

// Only the previous/current heading paths render when scroll tracking changes the active item.
const OutlineBranch = memo(function OutlineBranch(props: Omit<OutlineLevelProps, "nodes"> & { node: OutlineNode }) {
  const { t } = useI18n();
  const { node } = props;
  const childPath = useMemo(() => props.activePath.slice(1), [props.activePath]);
  const hasChildren = node.children.length > 0;
  const expanded = !props.collapsed.has(node.key);
  const selected = props.activePath.length === 1;
  const groupId = `${props.groupPrefix}-${node.item.id}`;
  return <li className="outline-node" data-outline-id={node.item.id} data-outline-level={node.level} key={node.key}>
    <div className={`outline-row ${selected ? "active" : ""}`}>
      {hasChildren ? <button className="outline-toggle" aria-expanded={expanded} aria-controls={groupId}
        aria-label={t(expanded ? "outline.collapseHeading" : "outline.expandHeading", { title: node.item.text })}
        onClick={() => props.onToggle(node.key)}><AppIcon icon={expanded ? ChevronDown : ChevronRight} size={16} /></button>
        : <span className="outline-spacer" aria-hidden="true" />}
      <button className="outline-title" aria-current={selected ? "location" : undefined} onClick={() => props.onSelect(node)}>{node.item.text}</button>
    </div>
    {hasChildren && <ul className="outline-children" id={groupId} hidden={!expanded}>
      <OutlineLevel {...props} nodes={node.children} activePath={childPath.length ? childPath : EMPTY_PATH} />
    </ul>}
  </li>;
});

export function OutlinePanel({ items, activeId, onSelect }: { items: readonly OutlineItem[]; activeId: string | null; onSelect: (item: OutlineItem) => void }) {
  const { t } = useI18n();
  const groupPrefix = useId();
  const panel = useRef<HTMLElement>(null);
  const currentSelect = useRef(onSelect);
  currentSelect.current = onSelect;
  const { nodes, paths } = useMemo(() => {
    const nodes = buildOutlineTree(items);
    const paths = new Map<string, readonly string[]>();
    const visit = (nodes: OutlineNode[], parent: readonly string[]) => {
      for (const node of nodes) {
        const path = [...parent, node.key];
        paths.set(node.item.id, path);
        visit(node.children, path);
      }
    };
    visit(nodes, EMPTY_PATH);
    return { nodes, paths };
  }, [items]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const activePath = useMemo(() => {
    const path = activeId ? paths.get(activeId) ?? EMPTY_PATH : EMPTY_PATH;
    const folded = path.findIndex(key => collapsed.has(key));
    return folded >= 0 ? path.slice(0, folded + 1) : path;
  }, [activeId, paths, collapsed]);
  const visibleActiveKey = activePath.at(-1);
  useEffect(() => {
    const area = panel.current;
    const row = area?.querySelector<HTMLElement>(".outline-row.active");
    if (area && row) revealScrollRect({ element: area, top: 0, bottom: 0 }, row.getBoundingClientRect());
  }, [visibleActiveKey]);
  const toggle = useCallback((key: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const select = useCallback((node: OutlineNode) => currentSelect.current(node.item), []);
  return <nav className="outline-list" ref={panel} aria-label={t("app.noteOutline")}>
    {nodes.length ? <ul className="outline-tree"><OutlineLevel nodes={nodes} collapsed={collapsed} activePath={activePath} groupPrefix={groupPrefix}
      onToggle={toggle} onSelect={select} /></ul>
      : <p className="outline-empty">{t("app.outlineEmpty")}</p>}
  </nav>;
}
