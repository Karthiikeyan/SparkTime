"use client";

import { Extension, ReactRenderer, type Editor, type Range } from "@tiptap/react";
import { Suggestion, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import {
  AudioLines,
  Bookmark,
  Calculator,
  CheckSquare,
  ChevronRightSquare,
  Code2,
  Columns2,
  Columns3,
  FileDown,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Images,
  Info,
  Layers,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Pilcrow,
  Quote,
  Table,
  Video,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Generic popup list shared by "/" and "@"
// ---------------------------------------------------------------------------

export type MenuItem = { id: string; title: string; hint?: string; group: string; icon?: React.ReactNode; keywords?: string };

type ListProps = { items: MenuItem[]; onSelect: (item: MenuItem) => void; emptyLabel: string };
export type ListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

const SuggestionList = forwardRef<ListHandle, ListProps>(function SuggestionList({ items, onSelect, emptyLabel }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);
  useEffect(() => {
    document.getElementById(`suggestion-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") {
        setActive((i) => (items.length ? (i + 1) % items.length : 0));
        return true;
      }
      if (event.key === "ArrowUp") {
        setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        if (item) onSelect(item);
        return Boolean(item);
      }
      return false;
    },
  }));

  let lastGroup = "";
  return (
    <div role="listbox" aria-label="Insert" className="max-h-80 w-72 overflow-y-auto rounded-md border border-line bg-elevated p-1.5 text-ink shadow-float">
      {items.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">{emptyLabel}</p>}
      {items.map((item, index) => {
        const header = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-subtle">{header}</p>}
            <button
              id={`suggestion-opt-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              className={cn("flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm", index === active && "bg-surface-2")}
            >
              {item.icon && <span className="flex size-7 shrink-0 items-center justify-center rounded-xs border border-line bg-surface text-muted">{item.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.title}</span>
                {item.hint && <span className="block truncate text-xs text-subtle">{item.hint}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Positions a React popup at the caret without a positioning library. */
function popupRenderer(emptyLabel: string) {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
    let host: HTMLDivElement | null = null;

    const place = (rect: DOMRect | null) => {
      if (!host || !rect) return;
      const height = host.offsetHeight || 320;
      const below = rect.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
      const left = Math.min(rect.left, window.innerWidth - 300);
      host.style.top = `${top}px`;
      host.style.left = `${Math.max(8, left)}px`;
    };

    return {
      onStart: (props: SuggestionProps<MenuItem>) => {
        host = document.createElement("div");
        host.style.position = "fixed";
        host.style.zIndex = "70";
        document.body.appendChild(host);
        renderer = new ReactRenderer(SuggestionList, {
          editor: props.editor,
          props: { items: props.items, onSelect: (item: MenuItem) => props.command(item), emptyLabel },
        });
        host.appendChild(renderer.element);
        place(props.clientRect?.() ?? null);
      },
      onUpdate: (props: SuggestionProps<MenuItem>) => {
        renderer?.updateProps({ items: props.items, onSelect: (item: MenuItem) => props.command(item), emptyLabel });
        place(props.clientRect?.() ?? null);
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "Escape") {
          host?.remove();
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        renderer?.destroy();
        host?.remove();
        renderer = null;
        host = null;
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

type SlashItem = MenuItem & { run: (editor: Editor, range: Range) => void };

const icon = (Icon: typeof Pilcrow) => <Icon size={15} aria-hidden="true" />;

export const SLASH_ITEMS: SlashItem[] = [
  { id: "p", title: "Text", hint: "Plain paragraph", group: "Basic", icon: icon(Pilcrow), keywords: "paragraph", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: "h1", title: "Heading 1", hint: "Section heading", group: "Basic", icon: icon(Heading1), keywords: "title h1", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: "h2", title: "Heading 2", hint: "Sub-section", group: "Basic", icon: icon(Heading2), keywords: "subtitle h2", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: "h3", title: "Heading 3", group: "Basic", icon: icon(Heading3), keywords: "h3", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: "ul", title: "Bullet list", group: "Basic", icon: icon(List), keywords: "unordered", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "ol", title: "Numbered list", group: "Basic", icon: icon(ListOrdered), keywords: "ordered", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "todo", title: "Checklist", group: "Basic", icon: icon(CheckSquare), keywords: "task todo", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: "quote", title: "Quote", group: "Basic", icon: icon(Quote), keywords: "blockquote", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: "callout", title: "Callout", hint: "Note, tip, warning", group: "Basic", icon: icon(Info), keywords: "note tip warning aside", run: (e, r) => e.chain().focus().deleteRange(r).setCallout("note").run() },
  { id: "divider", title: "Divider", group: "Basic", icon: icon(Minus), keywords: "hr rule line", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: "code", title: "Code block", group: "Basic", icon: icon(Code2), keywords: "snippet", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { id: "image", title: "Image", hint: "Upload or paste", group: "Media", icon: icon(ImageIcon), keywords: "photo picture", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("image").run() },
  { id: "gallery", title: "Gallery", group: "Media", icon: icon(Images), keywords: "images grid", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("gallery").run() },
  { id: "youtube", title: "Video (YouTube)", group: "Media", icon: icon(Video), keywords: "youtube video", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("youtube").run() },
  { id: "embed", title: "Embed", hint: "Vimeo, CodePen, Spotify, Loom", group: "Media", icon: icon(MousePointerClick), keywords: "iframe vimeo codepen spotify loom", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("embed").run() },
  { id: "audio", title: "Audio", group: "Media", icon: icon(AudioLines), keywords: "mp3 podcast", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("audio").run() },
  { id: "file", title: "File / PDF", group: "Media", icon: icon(FileDown), keywords: "pdf download attachment", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("file").run() },
  { id: "bookmark", title: "Link preview", hint: "Card for a URL", group: "Media", icon: icon(Bookmark), keywords: "bookmark url card", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("bookmark").run() },
  { id: "cols2", title: "Two columns", group: "Layout", icon: icon(Columns2), keywords: "columns grid side", run: (e, r) => e.chain().focus().deleteRange(r).insertColumns(2).run() },
  { id: "cols3", title: "Three columns", group: "Layout", icon: icon(Columns3), keywords: "columns grid", run: (e, r) => e.chain().focus().deleteRange(r).insertColumns(3).run() },
  { id: "toggle", title: "Toggle / accordion", group: "Layout", icon: icon(ChevronRightSquare), keywords: "details accordion collapse", run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { id: "table", title: "Table", group: "Layout", icon: icon(Table), keywords: "grid rows", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "button", title: "Button", hint: "Call to action", group: "Advanced", icon: icon(Link2), keywords: "cta link", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("button").run() },
  { id: "related", title: "Related content", hint: "Pick documents", group: "Advanced", icon: icon(Layers), keywords: "links reading", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("relatedContent").run() },
  { id: "tool", title: "FI calculator", hint: "Interactive tool", group: "Advanced", icon: icon(Calculator), keywords: "fire money calculator finance", run: (e, r) => e.chain().focus().deleteRange(r).insertBlock("tool").run() },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q) || (i.keywords ?? "").includes(q)).sort(
    (a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)),
  );
}

export const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    const options: Omit<SuggestionOptions<MenuItem>, "editor"> = {
      char: "/",
      pluginKey: new PluginKey("slash"),
      allowSpaces: false,
      startOfLine: false,
      items: ({ query }) => filterSlashItems(query),
      command: ({ editor, range, props }) => {
        const item = SLASH_ITEMS.find((i) => i.id === props.id);
        item?.run(editor, range);
      },
      allow: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        return $from.parent.type.name !== "codeBlock";
      },
      render: popupRenderer("No matching blocks"),
    };
    return [Suggestion({ editor: this.editor, ...options })];
  },
});

// ---------------------------------------------------------------------------
// "@" document mentions
// ---------------------------------------------------------------------------

export function createMentionExtension(lookup: (q: string) => Promise<Array<{ id: string; title: string; typeName: string; isPublic: boolean }>>) {
  return Extension.create({
    name: "docMentions",
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuItem>({
          editor: this.editor,
          char: "@",
          pluginKey: new PluginKey("docMention"),
          allowSpaces: true,
          items: async ({ query }) => {
            const found = await lookup(query);
            return found.slice(0, 8).map((d) => ({ id: d.id, title: d.title || "Untitled", hint: `${d.typeName}${d.isPublic ? "" : " · not public yet"}`, group: "Link a document" }));
          },
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [{ type: "docRef", attrs: { documentId: props.id, label: props.title } }, { type: "text", text: " " }])
              .run();
          },
          render: popupRenderer("No documents found"),
        }),
      ];
    },
  });
}
