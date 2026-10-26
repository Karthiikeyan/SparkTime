"use client";

import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { EditorProps } from "@tiptap/pm/view";
import { cn } from "@/lib/cn";
import { safeHref } from "@/lib/url";
import { BlockHandle, BlockKeyboard } from "./block-handle";
import { clipboardFileName, prepareImage } from "./image-prep";
import { CUSTOM_NODES } from "./nodes";
import { adaptHtmlToSchema, choosePasteStrategy, loadPurifier, markdownToHtml, sanitizePastedHtml, stripHiddenHashtagLabels } from "./paste";
import { EditorServicesContext, type EditorServices } from "./services";
import { createMentionExtension, SlashCommands } from "./suggestion-menu";

type Props = {
  initialContent: JSONContent;
  services: EditorServices;
  onChange: (doc: JSONContent) => void;
  onError: (message: string) => void;
  mediaOrigin: string | null;
  editable?: boolean;
};

function isOwnMedia(src: string, mediaOrigin: string | null): boolean {
  return src.startsWith("/media/") || (mediaOrigin !== null && src.startsWith(`${mediaOrigin}/`));
}

/** Find a node by the temporary uploadId we tag placeholders with, and update it. */
function replaceUpload(editor: Editor, uploadId: string, attrs: Record<string, unknown> | null) {
  const { state } = editor;
  let found: { pos: number; size: number; attrs: Record<string, unknown> } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.uploadId === uploadId) found = { pos, size: node.nodeSize, attrs: node.attrs };
    return true;
  });
  if (!found) return;
  const { pos, size, attrs: current } = found as { pos: number; size: number; attrs: Record<string, unknown> };
  const tr = attrs ? state.tr.setNodeMarkup(pos, undefined, { ...current, ...attrs, uploadId: null, uploading: false }) : state.tr.delete(pos, pos + size);
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/**
 * Performance note: `useEditor` compares its options with the live editor's
 * after every render and calls `editor.setOptions()` — a full ProseMirror
 * view update — when anything differs by reference. So the extensions and
 * editorProps are built once, and everything that changes between renders
 * (callbacks, services) is read through refs. The component is also memoised,
 * so typing in the title or a save-status change doesn't re-render it.
 */
export const BlockEditor = memo(function BlockEditor({ initialContent, services, onChange, onError, mediaOrigin, editable = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const servicesRef = useRef(services);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const mediaOriginRef = useRef(mediaOrigin);
  useEffect(() => {
    servicesRef.current = services;
    onChangeRef.current = onChange;
    onErrorRef.current = onError;
    mediaOriginRef.current = mediaOrigin;
  }, [services, onChange, onError, mediaOrigin]);
  // `services` is memoised by the page, so this extension is created once per editor.
  const mention = useMemo(() => createMentionExtension(services.lookup), [services.lookup]);

  useEffect(() => {
    void loadPurifier();
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          isAllowedUri: (url) => Boolean(safeHref(url)),
          HTMLAttributes: { rel: "noopener noreferrer", target: null },
        },
        codeBlock: { languageClassPrefix: "language-" },
        dropcursor: { color: "var(--accent)", width: 2 },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Details.configure({ persist: true, HTMLAttributes: { class: "editor-details" } }),
      DetailsSummary,
      DetailsContent,
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : node.type.name === "detailsSummary" ? "Toggle title" : "Write, or type ‘/’ for blocks and ‘@’ to link a document…"),
        includeChildren: true,
      }),
      CharacterCount,
      ...CUSTOM_NODES,
      SlashCommands,
      mention,
      BlockKeyboard,
    ],
    [mention],
  );

  const editorProps = useMemo<EditorProps>(() => {
    const ownMedia = (src: string) => isOwnMedia(src, mediaOriginRef.current);
    const reportError = (message: string) => onErrorRef.current(message);

    const uploadFiles = (editor: Editor, files: File[], at: number) => {
      let insertAt = at;
      for (const raw of files.slice(0, 12)) {
        const isImage = raw.type.startsWith("image/");
        if (isImage) {
          const uploadId = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const preview = URL.createObjectURL(raw);
          editor.chain().insertContentAt(insertAt, { type: "image", attrs: { src: preview, alt: "", uploading: true, uploadId } }).run();
          insertAt += 1;
          void (async () => {
            try {
              const file = await prepareImage(new File([raw], clipboardFileName(raw), { type: raw.type }));
              const asset = await servicesRef.current.upload(file);
              replaceUpload(editor, uploadId, { src: asset.url, mediaId: asset.id, width: asset.width, height: asset.height });
            } catch (error) {
              replaceUpload(editor, uploadId, null);
              reportError(error instanceof Error ? error.message : "Upload failed.");
            } finally {
              URL.revokeObjectURL(preview);
            }
          })();
        } else {
          void (async () => {
            try {
              const asset = await servicesRef.current.upload(raw);
              const node =
                asset.kind === "audio"
                  ? { type: "audio", attrs: { src: asset.url, mediaId: asset.id, title: asset.originalName } }
                  : { type: "file", attrs: { src: asset.url, mediaId: asset.id, name: asset.originalName, size: asset.sizeBytes, mimeType: asset.mimeType } };
              editor.chain().insertContentAt(Math.min(insertAt, editor.state.doc.content.size), node).run();
            } catch (error) {
              reportError(error instanceof Error ? error.message : "Upload failed.");
            }
          })();
        }
      }
    };

    return {
      attributes: { class: "studio-editor prose prose-serif outline-none", "aria-label": "Document body", role: "textbox", "aria-multiline": "true" },
      transformPastedHTML: (html) => sanitizePastedHtml(adaptHtmlToSchema(html, ownMedia).html),
      transformPastedText: (text) => stripHiddenHashtagLabels(text),
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data || !editorRef.current) return false;
        if (view.state.selection.$from.parent.type.name === "codeBlock") return false;
        const files = Array.from(data.files ?? []);
        const html = data.getData("text/html");
        const text = data.getData("text/plain");
        const strategy = choosePasteStrategy({ hasFiles: files.length > 0, html, text });
        if (strategy === "files") {
          uploadFiles(editorRef.current, files, view.state.selection.from);
          return true;
        }
        if (strategy === "markdown") {
          const adapted = adaptHtmlToSchema(markdownToHtml(text), ownMedia);
          editorRef.current.commands.insertContent(sanitizePastedHtml(adapted.html));
          if (adapted.droppedImages) reportError(`${adapted.droppedImages} external image(s) weren't imported — paste or upload them as files.`);
          return true;
        }
        if (strategy === "html") {
          const { droppedImages } = adaptHtmlToSchema(html, ownMedia);
          if (droppedImages) reportError(`${droppedImages} external image(s) weren't imported — paste or upload them as files.`);
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !editorRef.current) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        uploadFiles(editorRef.current, files, coords?.pos ?? view.state.selection.from);
        return true;
      },
    };
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions,
    content: initialContent,
    editorProps,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON()),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  if (!editor) return <div className="min-h-[40vh] animate-pulse rounded-md bg-surface-2/60" aria-hidden="true" />;

  return (
    <EditorServicesContext.Provider value={services}>
      <Toolbar editor={editor} onPickImage={async () => {
        const asset = await services.pickMedia("image");
        if (asset) editor.chain().focus().insertContent({ type: "image", attrs: { src: asset.url, mediaId: asset.id, width: asset.width, height: asset.height, alt: asset.alt } }).run();
      }} />
      <div ref={containerRef} className="relative md:pl-14">
        <BlockHandle editor={editor} container={containerRef} />
        <FormattingBubble editor={editor} />
        <EditorContent editor={editor} />
      </div>
      <WordCount editor={editor} />
    </EditorServicesContext.Provider>
  );
});

function ToolbarButton({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40", active && "bg-surface-2 text-ink")}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-24 z-20 -mx-2 mb-4 flex items-center gap-0.5 overflow-x-auto border-b border-line bg-bg/95 px-2 py-1.5 backdrop-blur-sm sm:top-14">
      <ToolbarButton label="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!state.canUndo}>
        <Undo2 size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Redo (Ctrl+Shift+Z)" onClick={() => editor.chain().focus().redo().run()} disabled={!state.canRedo}>
        <Redo2 size={16} aria-hidden="true" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton label="Heading 1" active={state.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={16} aria-hidden="true" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton label="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Checklist" active={state.task} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <CheckSquare size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={16} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label="Insert image" onClick={onPickImage}>
        <ImagePlus size={16} aria-hidden="true" />
      </ToolbarButton>
      <span className="ml-auto hidden shrink-0 pl-3 text-xs text-subtle lg:inline">Type / for blocks · @ to link</span>
    </div>
  );
}

function FormattingBubble({ editor }: { editor: Editor }) {
  const [linkMode, setLinkMode] = useState(false);
  const [href, setHref] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state: s }) => !s.selection.empty && e.isEditable && !e.isActive("codeBlock") && !e.isActive("image")}
      className="flex items-center gap-0.5 rounded-md border border-line bg-elevated p-1 shadow-float"
    >
      {linkMode ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const safe = safeHref(href.trim().match(/^[a-z]+:|^\/|^#/i) ? href.trim() : `https://${href.trim()}`);
            if (href.trim() && safe) editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
            else editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkMode(false);
          }}
        >
          <input value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://… or /about" autoFocus className="h-8 w-56 rounded-xs border border-line bg-surface px-2 text-sm outline-none focus:border-accent" aria-label="Link URL" />
          <button type="submit" className="btn btn-primary btn-sm">
            Apply
          </button>
        </form>
      ) : (
        <>
          <ToolbarButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Underline" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={state.link}
            onClick={() => {
              setHref(state.linkHref);
              setLinkMode(true);
            }}
          >
            <Link2 size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().run()}>
            <RemoveFormatting size={15} aria-hidden="true" />
          </ToolbarButton>
        </>
      )}
    </BubbleMenu>
  );
}

function WordCount({ editor }: { editor: Editor }) {
  const words = useEditorState({ editor, selector: ({ editor: e }) => (e.storage.characterCount as { words: () => number } | undefined)?.words() ?? 0 });
  return (
    <p className="mt-6 text-right font-mono text-[11px] text-subtle" aria-live="off">
      {words} words · ~{Math.max(1, Math.round(words / 230))} min read
    </p>
  );
}
