"use client";

import type { JSONContent } from "@tiptap/react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, CloudOff, ExternalLink, Eye, Loader2, MoreHorizontal, PanelRight, Rocket, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BlockEditor } from "@/editor/block-editor";
import type { EditorServices } from "@/editor/services";
import { draftKey, useAutosave, type SaveStatus } from "@/editor/use-autosave";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/dates";
import type { FieldDefinition, RelationKind } from "@/lib/content/model";
import { publicationOutcome, publishPreview } from "@/lib/content/publication";
import type { MediaAsset } from "@/lib/media";
import { api, ApiError, errorMessage } from "./api";
import { DetailsPanel, ItemsPanel, PropertiesPanel, RelationsPanel, SeoPanel, TaxonomyPanel } from "./document-panels";
import { GuideEditor } from "./interviews/guide-editor";
import { Badge, statusTone, TextArea } from "./fields";
import { useMediaPicker, uploadFile } from "./media-picker";
import { ConfirmDialog } from "./modal";
import { useToast } from "./toast";
import { useDismiss } from "@/components/ui/use-dismiss";

export type EditorBootstrap = {
  id: string;
  version: number;
  status: string;
  visibility: string;
  slug: string;
  path: string;
  hasStagedChanges: boolean;
  body: { title: string; excerpt: string; content: JSONContent; properties: Record<string, unknown>; featuredMediaId: string | null };
  settings: { seoTitle: string; seoDescription: string; canonicalUrl: string; robotsIndex: string; featured: boolean; priority: number; templateOverride: string | null; notes: string; publishedAt: string | null };
  updatedAt: string;
  type: { id: string; name: string; slug: string; template: string; fields: FieldDefinition[]; indexable: boolean };
  categories: Array<{ id: string; name: string; slug: string; isPrimary: boolean }>;
  tags: Array<{ id: string; name: string; slug: string }>;
  relations: Array<{ targetId: string; kind: RelationKind; note: string; title: string; typeName: string }>;
  backlinks: Array<{ sourceId: string; kind: RelationKind; title: string; typeName: string }>;
  items: Array<{ documentId: string; groupLabel: string; note: string; title: string; typeName: string; status: string }>;
};

export type EditorContext = {
  types: Array<{ id: string; name: string; archived: boolean }>;
  allCategories: Array<{ id: string; name: string; parentId: string | null; archivedAt: string | null }>;
  allTags: Array<{ id: string; name: string }>;
  media: Record<string, MediaAsset>;
  titles: Record<string, string>;
  mediaOrigin: string | null;
  siteUrl: string;
  /** For the SEO panel's search preview — the same template public pages use. */
  siteName: string;
  titleTemplate: string;
};

type Panel = "details" | "properties" | "taxonomy" | "relations" | "items" | "seo" | "notes";

const noopSubscribe = () => () => undefined;

function subscribeMobileSettings(listener: () => void) {
  const query = window.matchMedia("(max-width: 1023px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const mobileSettingsSnapshot = () => window.matchMedia("(max-width: 1023px)").matches;

function readDraft(id: string): string | null {
  try {
    return localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
}

function SaveIndicator({ status, lastSavedAt, error, staged }: { status: SaveStatus; lastSavedAt: Date | null; error: string | null; staged: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const label =
    status === "saving"
      ? "Saving…"
      : status === "dirty"
        ? "Unsaved changes"
        : status === "error"
          ? error ?? "Couldn't save"
          : status === "conflict"
            ? "Conflict"
            : lastSavedAt
              ? `Saved ${relativeTime(lastSavedAt)}`
              : "All changes saved";
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs", status === "error" || status === "conflict" ? "text-danger" : "text-subtle")}>
      {status === "saving" ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : status === "error" || status === "conflict" ? <CloudOff size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
      <span className="max-w-56 truncate">{label}</span>
      {staged && status !== "error" && <Badge tone="warning">staged</Badge>}
    </span>
  );
}

export function DocumentEditor({ doc, ctx }: { doc: EditorBootstrap; ctx: EditorContext }) {
  const router = useRouter();
  const toast = useToast();
  const { pick, element: pickerElement } = useMediaPicker();
  const [title, setTitle] = useState(doc.body.title);
  const [excerpt, setExcerpt] = useState(doc.body.excerpt);
  const [properties, setProperties] = useState(doc.body.properties);
  const [featuredId, setFeaturedId] = useState(doc.body.featuredMediaId);
  const [media, setMedia] = useState(ctx.media);
  const [settings, setSettings] = useState(doc.settings);
  const [status, setStatus] = useState(doc.status);
  const [visibility, setVisibility] = useState(doc.visibility);
  const [staged, setStaged] = useState(doc.hasStagedChanges);
  const [categories, setCategories] = useState(doc.categories);
  const [tags, setTags] = useState(doc.tags);
  const [panel, setPanel] = useState<Panel>(doc.type.fields.length ? "properties" : "details");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mobileSettings = useSyncExternalStore(subscribeMobileSettings, mobileSettingsSnapshot, () => false);
  const settingsRef = useRef<HTMLElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const SettingsContainer = mobileSettings ? "dialog" : "aside";
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  // Interview pages: their guide needs the page's width, not the sidebar.
  const guideField = doc.type.fields.find((f) => f.type === "interview_guide") ?? null;
  const roleKey = doc.type.fields.find((f) => f.role === "interviewRole")?.key ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "discard">(null);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // What the block editor is (re)mounted with. The live document stays inside
  // the editor; it is not mirrored into React state on every keystroke.
  const [initialContent, setInitialContent] = useState<JSONContent>(doc.body.content);
  // Publishing can replace a placeholder slug, so the URL is state: set from the
  // publish response at once, and re-synced whenever fresh props arrive.
  const [docUrl, setDocUrl] = useState({ slug: doc.slug, path: doc.path });
  const [docUrlFromProps, setDocUrlFromProps] = useState({ slug: doc.slug, path: doc.path });
  if (docUrlFromProps.slug !== doc.slug || docUrlFromProps.path !== doc.path) {
    setDocUrlFromProps({ slug: doc.slug, path: doc.path });
    setDocUrl({ slug: doc.slug, path: doc.path });
  }
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu, menuTrigger);

  const autosave = useAutosave({
    documentId: doc.id,
    initialVersion: doc.version,
    onSaved: (r) => setStaged(r.stagedChanges),
  });

  // Crash recovery: a local copy newer than the server's means unsaved work.
  // Read once from localStorage (server snapshot is null, so hydration is safe).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [rawDraft, setRawDraft] = useState<string | null | undefined>(undefined);
  if (hydrated && rawDraft === undefined) setRawDraft(readDraft(doc.id));
  const recovered = useMemo(() => {
    if (!rawDraft || recoveryDismissed) return null;
    try {
      const draft = JSON.parse(rawDraft) as { body?: Record<string, unknown>; at?: number };
      return draft.body && draft.at && draft.at > new Date(doc.updatedAt).getTime() + 1000 ? { body: draft.body, at: draft.at } : null;
    } catch {
      return null;
    }
  }, [rawDraft, recoveryDismissed, doc.updatedAt]);

  // Leave with the owner signed out? Keep the local copy and go to login.
  useEffect(() => {
    const onUnauthorized = () => toast.error("Session expired. Your edits are safe in this browser — sign in again to save.");
    window.addEventListener("studio:unauthorized", onUnauthorized);
    return () => window.removeEventListener("studio:unauthorized", onUnauthorized);
  }, [toast]);

  useEffect(() => {
    if (!doc.body.title) titleRef.current?.focus();
  }, [doc.body.title]);

  useEffect(() => {
    const field = titleRef.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [title]);

  useEffect(() => {
    if (!sidebarOpen || !mobileSettings) return;
    const dialog = settingsRef.current;
    if (!(dialog instanceof HTMLDialogElement)) return;
    const trigger = settingsTrigger.current;
    dialog.showModal();
    return () => {
      dialog.close();
      trigger?.focus();
    };
  }, [sidebarOpen, mobileSettings]);

  const services: EditorServices = useMemo(
    () => ({
      documentId: doc.id,
      upload: async (file) => {
        const asset = await uploadFile(file);
        setMedia((m) => ({ ...m, [asset.id]: asset }));
        return asset;
      },
      lookup: async (q) => (await api<{ items: Array<{ id: string; title: string; typeName: string; path: string; status: string; isPublic: boolean }> }>(`/api/admin/documents/lookup?q=${encodeURIComponent(q)}&exclude=${doc.id}`)).items,
      linkPreview: (url) => api("/api/admin/link-preview", { method: "POST", body: { url } }),
      pickMedia: pick,
      titles: ctx.titles,
    }),
    [doc.id, pick, ctx.titles],
  );

  const { queue } = autosave;
  const onContentChange = useCallback((json: JSONContent) => queue({ body: { content: json } }), [queue]);
  const onEditorError = useCallback((message: string) => toast.error(message), [toast]);

  const updateSettings = (patch: Record<string, unknown>) => {
    setSettings((s) => ({ ...s, ...(patch as Partial<typeof s>) }));
    if (typeof patch.visibility === "string") setVisibility(patch.visibility);
    autosave.queue({ settings: patch });
  };

  type ActionResult = { id: string; slug?: string; path?: string; version?: number };
  const run = async (label: string, body: Record<string, unknown>, after?: (r: ActionResult) => void) => {
    setBusy(label);
    setMenuOpen(false);
    try {
      await autosave.flush();
      const result = await api<ActionResult>(`/api/admin/documents/${doc.id}/actions`, { method: "POST", body });
      // The action bumped the version; the next autosave must expect it, or it reads as a conflict.
      if (result.id === doc.id && typeof result.version === "number") autosave.syncVersion(result.version);
      setPublishErrors({});
      if (after) after(result);
      else router.refresh();
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        setPublishErrors(e.details);
        // An interview guide is edited below the body, so only sidebar fields open the sidebar.
        if (Object.keys(e.details).some((key) => doc.type.fields.some((field) => field.key === key && field.type !== "interview_guide"))) {
          setPanel("properties");
          setSidebarOpen(true);
        }
      }
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = () =>
    run("publish", { action: "publish" }, (r) => {
      if (r.slug && r.path) setDocUrl({ slug: r.slug, path: r.path });
      setStatus("published");
      setStaged(false);
      toast.success(status === "published" ? "Changes are live." : "Published.");
      router.refresh();
    });

  // One plain sentence about the result: what Publish will do, or what the page is now.
  const outcomeFacts = { visibility, robotsIndex: settings.robotsIndex, typeIndexable: doc.type.indexable };
  const willPublish = publishPreview(outcomeFacts);
  const hiddenReason =
    status === "published"
      ? visibility === "private"
        ? "Published but private — only you can see it. Set “Who can see it” to Everyone to make it public."
        : null
      : status === "archived"
        ? publicationOutcome({ status, ...outcomeFacts }).summary
        : `Not on the site yet. Publish makes it: ${willPublish.summary.charAt(0).toLowerCase()}${willPublish.summary.slice(1)}`;

  return (
    <div className="flex min-h-dvh">
      {pickerElement}
      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <div className="sticky top-0 z-30 flex h-24 flex-wrap content-center items-center gap-x-2 gap-y-1 border-b border-line bg-bg/95 px-3 py-2 backdrop-blur-sm sm:h-14 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-0">
          <Link href="/admin/documents" className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2" aria-label="Back to documents">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <span className="hidden text-sm text-muted sm:inline">{doc.type.name}</span>
          <Badge tone={statusTone(status)}>{status}</Badge>
          {visibility !== "public" && <Badge>{visibility}</Badge>}
          <SaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} error={autosave.error} staged={staged} />
          <div className="ml-auto flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
            <a href={`/preview/${doc.id}`} target="_blank" rel="noopener" className="btn btn-ghost btn-md" aria-label="Preview document" onClick={async (event) => {
              event.preventDefault();
              const preview = window.open("about:blank", "_blank");
              if (preview) preview.opener = null;
              try {
                await autosave.flush();
                if (preview) preview.location.replace(`/preview/${doc.id}`);
                else router.push(`/preview/${doc.id}`);
              } catch (error) {
                preview?.close();
                toast.error(errorMessage(error));
              }
            }}>
              <Eye size={15} aria-hidden="true" /> <span className="hidden sm:inline">Preview</span>
            </a>
            {status === "published" && visibility !== "private" && (
              <a href={docUrl.path} target="_blank" rel="noopener" className="hidden size-9 items-center justify-center rounded-sm text-muted hover:bg-surface-2 sm:inline-flex" aria-label="View live page">
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
            <button type="button" className="btn btn-accent btn-md" onClick={() => void publish()} disabled={busy !== null || (status === "published" && !staged)}>
              {busy === "publish" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Rocket size={15} aria-hidden="true" />}
              {status === "published" ? (staged ? "Publish changes" : "Published") : "Publish"}
            </button>
            <div ref={menuRef} className="relative">
              <button ref={menuTrigger} type="button" onClick={() => setMenuOpen((o) => !o)} className="inline-flex size-9 items-center justify-center rounded-sm text-muted hover:bg-surface-2" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen}>
                <MoreHorizontal size={17} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-11 z-40 w-64 rounded-md border border-line bg-elevated p-1.5 text-sm shadow-float">
                  {staged && (
                    <MenuItem onClick={() => setConfirm("discard")}>Discard staged changes</MenuItem>
                  )}
                  {status === "published" && <MenuItem onClick={() => void run("unpublish", { action: "setStatus", status: "draft" }, () => { setStatus("draft"); setStaged(false); router.refresh(); })}>Unpublish (back to draft)</MenuItem>}
                  {status !== "archived" ? (
                    <MenuItem onClick={() => void run("archive", { action: "setStatus", status: "archived" }, () => { setStatus("archived"); setStaged(false); router.refresh(); })}>Archive</MenuItem>
                  ) : (
                    <MenuItem onClick={() => void run("restore", { action: "setStatus", status: "draft" }, () => { setStatus("draft"); setStaged(false); router.refresh(); })}>Restore as draft</MenuItem>
                  )}
                  <MenuItem onClick={() => void run("duplicate", { action: "duplicate" }, (r) => router.push(`/admin/documents/${r.id}`))}>Duplicate</MenuItem>
                  <div className="my-1 h-px bg-line" />
                  <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-subtle">Convert this into…</p>
                  <div className="max-h-40 overflow-y-auto">
                    {ctx.types
                      .filter((t) => t.id !== doc.type.id && !t.archived)
                      .map((t) => (
                        <MenuItem key={t.id} onClick={() => void run("convert", { action: "convert", typeId: t.id }, () => { toast.success(`Converted to ${t.name}.`); router.refresh(); })}>
                          {t.name}
                        </MenuItem>
                      ))}
                  </div>
                  <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-subtle">Create a new … from this</p>
                  <div className="max-h-40 overflow-y-auto">
                    {ctx.types
                      .filter((t) => !t.archived)
                      .map((t) => (
                        <MenuItem key={t.id} onClick={() => void run("derive", { action: "derive", typeId: t.id }, (r) => router.push(`/admin/documents/${r.id}`))}>
                          {t.name}
                        </MenuItem>
                      ))}
                  </div>
                  <div className="my-1 h-px bg-line" />
                  <MenuItem danger onClick={() => setConfirm("delete")}>
                    Move to Trash…
                  </MenuItem>
                </div>
              )}
            </div>
            <button ref={settingsTrigger} type="button" onClick={() => setSidebarOpen((o) => !o)} className="inline-flex size-9 items-center justify-center rounded-sm text-muted hover:bg-surface-2" aria-label={sidebarOpen ? "Hide details panel" : "Show details panel"} aria-pressed={sidebarOpen}>
              <PanelRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Banners */}
        <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-8">
          {recovered && (
            <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-warning/50 bg-warning/5 px-4 py-3 text-sm">
              <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
              <span className="flex-1">Unsaved changes from {relativeTime(recovered.at)} were found in this browser.</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const b = recovered.body as EditorBootstrap["body"];
                  if (typeof b.title === "string") setTitle(b.title);
                  if (typeof b.excerpt === "string") setExcerpt(b.excerpt);
                  if (b.properties) setProperties(b.properties);
                  if (b.content) {
                    setInitialContent(b.content);
                    setEditorKey((k) => k + 1);
                  }
                  autosave.queue({ body: recovered.body }, true);
                  setRecoveryDismissed(true);
                }}
              >
                Restore
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  localStorage.removeItem(draftKey(doc.id));
                  setRecoveryDismissed(true);
                }}
              >
                Discard
              </button>
            </div>
          )}
          {autosave.status === "conflict" && (
            <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-danger/50 bg-danger/5 px-4 py-3 text-sm">
              <span className="flex-1">{autosave.error}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
                Reload latest
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void autosave.overwrite()}>
                Keep mine
              </button>
            </div>
          )}
          {staged && status === "published" && (
            <p className="mb-4 rounded-md border border-line bg-surface px-4 py-2.5 text-sm text-muted">
              You’re editing a published document. Changes are saved as a draft revision and go live when you click <strong className="text-ink">Publish changes</strong>.
            </p>
          )}
          {hiddenReason && !staged && <p className="mb-4 text-xs text-subtle">{hiddenReason}</p>}
          {Object.keys(publishErrors).length > 0 && (
            <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
              <p className="font-medium">Not ready to publish:</p>
              <ul className="mt-1 list-disc pl-5">
                {Object.values(publishErrors).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <button type="button" onClick={() => setPublishErrors({})} className="mt-2 inline-flex items-center gap-1 text-xs text-muted" aria-label="Dismiss">
                <X size={12} aria-hidden="true" /> Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Writing surface */}
        <div className="mx-auto max-w-3xl px-4 pb-32 sm:px-8">
          <label htmlFor="doc-title" className="sr-only">
            Title
          </label>
          <textarea
            id="doc-title"
            ref={titleRef}
            value={title}
            rows={1}
            onChange={(e) => {
              setTitle(e.target.value);
              autosave.queue({ body: { title: e.target.value } });
            }}
            placeholder="Untitled"
            className="mt-6 w-full resize-none overflow-hidden bg-transparent font-serif text-[2.4rem] leading-tight tracking-tight outline-none placeholder:text-line-strong"
          />
          <label htmlFor="doc-excerpt" className="sr-only">
            Excerpt
          </label>
          <textarea
            id="doc-excerpt"
            value={excerpt}
            rows={2}
            onChange={(e) => {
              setExcerpt(e.target.value);
              autosave.queue({ body: { excerpt: e.target.value } });
            }}
            placeholder="A one or two sentence summary (used in cards, feeds and search results)"
            maxLength={600}
            className="mt-2 w-full resize-none bg-transparent text-lg leading-relaxed text-muted outline-none placeholder:text-subtle"
          />
          <div className="mt-6">
            <BlockEditor key={editorKey} initialContent={initialContent} services={services} onChange={onContentChange} onError={onEditorError} mediaOrigin={ctx.mediaOrigin} />
          </div>
          {guideField && (
            <GuideEditor
              field={guideField}
              value={properties[guideField.key]}
              hasRole={Boolean(roleKey && typeof properties[roleKey] === "string" && String(properties[roleKey]).trim())}
              error={publishErrors[guideField.key]}
              onChange={(guide) => {
                const next = { ...properties, [guideField.key]: guide };
                setProperties(next);
                autosave.queue({ body: { properties: next } });
              }}
            />
          )}
        </div>
      </div>

      {/* Sidebar */}
      {sidebarOpen && (
        <SettingsContainer ref={(element) => { settingsRef.current = element; }} onCancel={() => setSidebarOpen(false)} className="fixed inset-y-0 left-auto right-0 z-40 m-0 h-dvh max-h-none w-full max-w-sm overflow-y-auto border-l border-line bg-surface p-0 text-ink backdrop:bg-black/30 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-88" aria-label="Document settings">
          <div className="sticky top-0 z-10 border-b border-line bg-surface">
            <div className="flex items-center justify-between px-4 pt-3 lg:hidden">
              <span className="text-sm font-medium">Settings</span>
              <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close settings" className="inline-flex size-8 items-center justify-center">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div role="tablist" aria-label="Document settings" className="flex gap-1 overflow-x-auto px-3 py-2" onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const current = tabs.findIndex((tab) => tab === document.activeElement);
              const next = event.key === "ArrowRight" ? (current + 1) % tabs.length
                : event.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              tabs[next]?.click();
              tabs[next]?.focus();
            }}>
              {(
                [
                  ["properties", "Properties"],
                  ["details", "Publish"],
                  ["taxonomy", "Topics"],
                  ["relations", "Links"],
                  ...(doc.type.template === "collection" ? [["items", "Items"]] : []),
                  ["seo", "SEO"],
                  ["notes", "Notes"],
                ] as Array<[Panel, string]>
              ).map(([key, label]) => (
                <button key={key} id={`document-${doc.id}-${key}-tab`} aria-controls={`document-${doc.id}-panel`} tabIndex={panel === key ? 0 : -1} type="button" role="tab" aria-selected={panel === key} onClick={() => setPanel(key)} className={cn("shrink-0 rounded-sm px-2.5 py-1.5 text-xs", panel === key ? "bg-ink text-bg" : "text-muted hover:bg-surface-2")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div id={`document-${doc.id}-panel`} className="p-4" role="tabpanel" aria-labelledby={`document-${doc.id}-${panel}-tab`}>
            {panel === "properties" && (
              <PropertiesPanel
                fields={doc.type.fields}
                values={properties}
                errors={publishErrors}
                pickMedia={pick}
                mediaById={media}
                titles={ctx.titles}
                onChange={(next) => {
                  setProperties(next);
                  autosave.queue({ body: { properties: next } });
                }}
              />
            )}
            {panel === "details" && (
              <DetailsPanel
                status={status}
                visibility={visibility}
                outcome={status === "published" || status === "archived" ? publicationOutcome({ status, ...outcomeFacts }).summary : `Publish makes it: ${willPublish.summary.charAt(0).toLowerCase()}${willPublish.summary.slice(1)}`}
                slug={docUrl.slug}
                path={docUrl.path}
                siteUrl={ctx.siteUrl}
                featured={settings.featured}
                priority={settings.priority}
                templateOverride={settings.templateOverride}
                typeTemplate={doc.type.template}
                publishedAt={settings.publishedAt}
                featuredImage={featuredId ? media[featuredId] ?? null : null}
                onSettings={updateSettings}
                onStatus={(s) => {
                  if (s === "published") void publish();
                  else void run("status", { action: "setStatus", status: s }, () => { setStatus(s); router.refresh(); });
                }}
                onSlug={async (slug) => {
                  const r = await run("slug", { action: "changeSlug", slug });
                  if (r) toast.success("URL updated.");
                }}
                onPickFeatured={async () => {
                  const asset = await pick("image");
                  if (!asset) return;
                  setMedia((m) => ({ ...m, [asset.id]: asset }));
                  setFeaturedId(asset.id);
                  autosave.queue({ body: { featuredMediaId: asset.id } });
                }}
                onClearFeatured={() => {
                  setFeaturedId(null);
                  autosave.queue({ body: { featuredMediaId: null } });
                }}
              />
            )}
            {panel === "taxonomy" && (
              <TaxonomyPanel
                documentId={doc.id}
                categories={categories}
                allCategories={ctx.allCategories}
                tags={tags}
                allTags={ctx.allTags}
                onUpdated={(next) => {
                  setCategories(next.categories);
                  setTags(next.tags);
                }}
              />
            )}
            {panel === "relations" && <RelationsPanel documentId={doc.id} initial={doc.relations} backlinks={doc.backlinks} />}
            {panel === "items" && <ItemsPanel documentId={doc.id} initial={doc.items} />}
            {panel === "seo" && (
              <SeoPanel
                title={title}
                excerpt={excerpt}
                path={docUrl.path}
                siteUrl={ctx.siteUrl}
                siteName={ctx.siteName}
                titleTemplate={ctx.titleTemplate}
                seoTitle={settings.seoTitle}
                seoDescription={settings.seoDescription}
                canonicalUrl={settings.canonicalUrl}
                robotsIndex={settings.robotsIndex}
                visibility={visibility}
                typeIndexable={doc.type.indexable}
                onSettings={updateSettings}
              />
            )}
            {panel === "notes" && (
              <div className="space-y-2">
                <TextArea label="Private notes" value={settings.notes} onChange={(v) => updateSettings({ notes: v })} rows={12} help="Only visible here. Never published, exported to feeds, or sent to readers." />
              </div>
            )}
          </div>
        </SettingsContainer>
      )}

      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        destructive
        title="Move to Trash?"
        body={
          <p>
            {status === "published" || status === "archived" ? "It disappears from the site at once. " : ""}
            Its topics, links and collection places are kept, and you can restore it from the Trash (as a draft) at any time.
          </p>
        }
        confirmLabel="Move to Trash"
        onConfirm={async () => {
          try {
            // Save pending edits first: a trashed document accepts no writes, and a restore should bring back the latest text.
            await autosave.flush();
            const result = await api<{ failed: number; items: Array<{ message?: string }> }>("/api/admin/documents/bulk", { method: "POST", body: { operationId: crypto.randomUUID(), ids: [doc.id], action: { action: "trash" } } });
            if (result.failed) throw new Error(result.items[0]?.message ?? "It couldn’t be moved to the Trash.");
            localStorage.removeItem(draftKey(doc.id));
            toast.success("Moved to Trash. Restore it from the Trash if you need it back.");
            router.push("/admin/documents");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={confirm === "discard"}
        onClose={() => setConfirm(null)}
        title="Discard staged changes?"
        body={<p>The live version stays exactly as it is; your unpublished edits are thrown away.</p>}
        confirmLabel="Discard"
        destructive
        onConfirm={async () => {
          setConfirm(null);
          await run("discard", { action: "discardChanges" }, () => {
            localStorage.removeItem(draftKey(doc.id));
            window.location.reload();
          });
        }}
      />
    </div>
  );
}

function MenuItem({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left", danger ? "text-danger hover:bg-danger/10" : "hover:bg-surface-2")}>
      {children}
      {!danger && <ChevronDown size={12} className="ml-auto -rotate-90 text-subtle" aria-hidden="true" />}
    </button>
  );
}
