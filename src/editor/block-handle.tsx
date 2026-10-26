"use client";

import { Extension, type Editor } from "@tiptap/react";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Block movement as editor transactions (so undo/redo covers them).
 * Works on top-level blocks and on blocks inside a column.
 */
type BlockRef = { pos: number; depth: number };

function containingBlock(state: EditorState): BlockRef | null {
  const $from = state.selection.$from;
  if (state.selection instanceof NodeSelection) {
    const parent = $from.parent.type.name;
    if ($from.depth === 0 || parent === "column") return { pos: $from.pos, depth: $from.depth + 1 };
  }
  for (let d = $from.depth; d > 0; d--) {
    const parent = $from.node(d - 1).type.name;
    if (parent === "doc" || parent === "column") return { pos: $from.before(d), depth: d };
  }
  return null;
}

export function moveBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1, at?: number): boolean {
  const pos = at ?? containingBlock(state)?.pos;
  if (pos === undefined) return false;
  const $pos = state.doc.resolve(pos);
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const parent = $pos.parent;
  const index = $pos.index();
  const siblingIndex = index + dir;
  if (siblingIndex < 0 || siblingIndex >= parent.childCount) return false;
  const sibling = parent.child(siblingIndex);
  if (!dispatch) return true;
  const tr = state.tr;
  const offsetInNode = state.selection.from - pos;
  tr.delete(pos, pos + node.nodeSize);
  const insertAt = dir === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  tr.insert(insertAt, node);
  const target = Math.min(insertAt + Math.max(offsetInNode, 1), tr.doc.content.size);
  try {
    tr.setSelection(node.isAtom ? NodeSelection.create(tr.doc, insertAt) : TextSelection.near(tr.doc.resolve(target)));
  } catch {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt)));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, at?: number): boolean {
  const pos = at ?? containingBlock(state)?.pos;
  if (pos === undefined) return false;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  if (dispatch) dispatch(state.tr.insert(pos + node.nodeSize, node.copy(node.content)).scrollIntoView());
  return true;
}

export const BlockKeyboard = Extension.create({
  name: "blockKeyboard",
  addKeyboardShortcuts() {
    return {
      "Alt-Shift-ArrowUp": ({ editor }) => moveBlock(editor.state, editor.view.dispatch, -1),
      "Alt-Shift-ArrowDown": ({ editor }) => moveBlock(editor.state, editor.view.dispatch, 1),
      "Mod-Shift-d": ({ editor }) => duplicateBlock(editor.state, editor.view.dispatch),
    };
  },
});

// ---------------------------------------------------------------------------
// Hover handle
// ---------------------------------------------------------------------------

/**
 * Begin a ProseMirror node drag: select the block and register it as the
 * view's drag payload with move semantics, so dropping it relocates the node
 * (as one undoable transaction) instead of copying it.
 */
function startNodeDrag(view: EditorView, pos: number): void {
  const selection = NodeSelection.create(view.state.doc, pos);
  view.dispatch(view.state.tr.setSelection(selection));
  (view as unknown as { dragging: { slice: ReturnType<NodeSelection["content"]>; move: boolean } | null }).dragging = { slice: selection.content(), move: true };
}

function blockAtCoords(view: EditorView, x: number, y: number): BlockRef | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  // Innermost block whose parent is the doc or a column.
  const $pos = view.state.doc.resolve(hit.pos);
  for (let d = $pos.depth; d > 0; d--) {
    const parentName = $pos.node(d - 1).type.name;
    if (parentName === "doc" || parentName === "column") return { pos: $pos.before(d), depth: d };
  }
  // Pointer over an atom block (image, video…): posAtCoords reports it via `inside`.
  if (hit.inside >= 0) {
    const $inside = view.state.doc.resolve(hit.inside);
    const parentName = $inside.parent.type.name;
    if (parentName === "doc" || parentName === "column") return { pos: hit.inside, depth: $inside.depth + 1 };
  }
  return null;
}

const TURN_INTO: Array<{ label: string; run: (e: Editor) => void }> = [
  { label: "Text", run: (e) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Heading 2", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Heading 3", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "Bullet list", run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Checklist", run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Quote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Callout", run: (e) => e.chain().focus().setCallout("note").run() },
  { label: "Code block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

export function BlockHandle({ editor, container }: { editor: Editor; container: React.RefObject<HTMLDivElement | null> }) {
  const [block, setBlock] = useState<{ pos: number; top: number; left: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = editor.view;
    const root = container.current;
    if (!root) return;
    const onMove = (event: MouseEvent) => {
      if (menuOpen) return;
      const editorRect = view.dom.getBoundingClientRect();
      if (event.clientY < editorRect.top || event.clientY > editorRect.bottom) return;
      const ref = blockAtCoords(view, Math.max(event.clientX, editorRect.left + 24), event.clientY);
      if (!ref) return;
      const dom = view.nodeDOM(ref.pos);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const lineOffset = Math.min(rect.height / 2, 14);
      setBlock({ pos: ref.pos, top: rect.top - rootRect.top + lineOffset - 12, left: rect.left - rootRect.left - 52 });
    };
    const onLeave = (event: MouseEvent) => {
      if (!root.contains(event.relatedTarget as Node | null) && !menuOpen) setBlock(null);
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, container, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const selectBlock = useCallback(() => {
    if (!block) return;
    const node = editor.state.doc.nodeAt(block.pos);
    if (!node) return;
    const tr = editor.state.tr.setSelection(node.isTextblock ? TextSelection.near(editor.state.doc.resolve(block.pos + 1)) : NodeSelection.create(editor.state.doc, block.pos));
    editor.view.dispatch(tr);
    editor.view.focus();
  }, [block, editor]);

  if (!block || !editor.isEditable) return null;

  return (
    <div className="absolute z-20 hidden items-center gap-0.5 md:flex" style={{ top: block.top, left: block.left }}>
      <button
        type="button"
        className="inline-flex size-6 items-center justify-center rounded-xs text-subtle hover:bg-surface-2 hover:text-ink"
        aria-label="Add a block below"
        title="Add a block below"
        onClick={() => {
          const node = editor.state.doc.nodeAt(block.pos);
          if (!node) return;
          const at = block.pos + node.nodeSize;
          editor.chain().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).insertContent("/").focus().run();
        }}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          draggable
          className="inline-flex size-6 cursor-grab items-center justify-center rounded-xs text-subtle hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
          aria-label="Drag to move, or click for block actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to move · click for options"
          onClick={() => {
            selectBlock();
            setMenuOpen((o) => !o);
          }}
          onDragStart={(event) => {
            const node = editor.state.doc.nodeAt(block.pos);
            if (!node) return;
            startNodeDrag(editor.view, block.pos);
            const dom = editor.view.nodeDOM(block.pos);
            if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.textContent.slice(0, 200));
          }}
          onDragEnd={() => setBlock(null)}
        >
          <GripVertical size={15} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div role="menu" aria-label="Block actions" className="absolute left-0 top-7 z-30 w-52 rounded-md border border-line bg-elevated p-1.5 text-sm shadow-float">
            <p className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-wider text-subtle">Turn into</p>
            <div className="grid grid-cols-2">
              {TURN_INTO.map((t) => (
                <button key={t.label} type="button" role="menuitem" className="rounded-sm px-2 py-1 text-left hover:bg-surface-2" onClick={() => { t.run(editor); setMenuOpen(false); }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-line" />
            {[
              { label: "Duplicate", hint: "⌘⇧D", icon: Copy, run: () => duplicateBlock(editor.state, editor.view.dispatch, block.pos) },
              { label: "Move up", hint: "⌥⇧↑", icon: ArrowUp, run: () => moveBlock(editor.state, editor.view.dispatch, -1, block.pos) },
              { label: "Move down", hint: "⌥⇧↓", icon: ArrowDown, run: () => moveBlock(editor.state, editor.view.dispatch, 1, block.pos) },
            ].map((a) => (
              <button key={a.label} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-2" onClick={() => { a.run(); setMenuOpen(false); setBlock(null); }}>
                <a.icon size={14} aria-hidden="true" /> {a.label} <span className="ml-auto text-xs text-subtle">{a.hint}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-danger hover:bg-danger/10"
              onClick={() => {
                const node = editor.state.doc.nodeAt(block.pos);
                if (node) editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + node.nodeSize));
                setMenuOpen(false);
                setBlock(null);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
