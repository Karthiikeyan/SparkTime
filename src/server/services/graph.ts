import "server-only";
import { and, inArray, notInArray, sql } from "drizzle-orm";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { documentPath } from "@/lib/content/paths";
import { RELATION_KINDS, isRelationKind } from "@/lib/content/model";
import { getDb } from "../db/client";
import { documentCategories, documentRelations, documents, documentTags } from "../db/schema";
import { listContentTypes } from "./content-types";
import { listCategories, listTags } from "./taxonomy";
import { listedSql } from "./visibility";

/**
 * The personal knowledge graph: listed documents, the topics (categories)
 * they belong to, well-used tags, and the relationships between documents.
 * Layout is computed on the server (deterministic seed) so the page ships as
 * static SVG with real links — crawlable, and cheap for phones.
 */

export type GraphNode = {
  id: string;
  kind: "document" | "category" | "tag";
  label: string;
  href: string;
  group: string;
  degree: number;
  x: number;
  y: number;
  r: number;
};

export type GraphEdge = { source: string; target: string; kind: string; label: string };

export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number };

const MAX_DOCUMENTS = 300;
const MIN_TAG_USES = 2;

type SimNode = SimulationNodeDatum & { id: string; r: number };

export async function buildKnowledgeGraph(): Promise<KnowledgeGraph> {
  const db = getDb();
  const [types, allCategories, allTags] = await Promise.all([listContentTypes(), listCategories(), listTags()]);
  const typeById = new Map(types.map((t) => [t.id, t]));

  const pageTypeIds = types.filter((t) => t.routing === "root").map((t) => t.id);
  const docs = await db
    .select({ id: documents.id, title: documents.title, slug: documents.slug, typeId: documents.typeId })
    .from(documents)
    .where(pageTypeIds.length ? and(listedSql(), notInArray(documents.typeId, pageTypeIds)) : listedSql())
    .orderBy(sql`${documents.featured} desc, ${documents.publishedAt} desc nulls last`)
    .limit(MAX_DOCUMENTS);
  const docIds = docs.map((d) => d.id);
  if (!docIds.length) return { nodes: [], edges: [], width: 1000, height: 700 };

  const [relations, catLinks, tagLinks] = await Promise.all([
    db
      .select({ source: documentRelations.sourceId, target: documentRelations.targetId, kind: documentRelations.kind })
      .from(documentRelations)
      .where(and(inArray(documentRelations.sourceId, docIds), inArray(documentRelations.targetId, docIds))),
    db.select().from(documentCategories).where(inArray(documentCategories.documentId, docIds)),
    db.select().from(documentTags).where(inArray(documentTags.documentId, docIds)),
  ]);

  const nodes = new Map<string, Omit<GraphNode, "x" | "y" | "r">>();
  for (const d of docs) {
    const type = typeById.get(d.typeId);
    if (!type) continue;
    nodes.set(d.id, { id: d.id, kind: "document", label: d.title || "Untitled", href: documentPath(type, d.slug), group: type.name, degree: 0 });
  }

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string, kind: string, label: string) => {
    const key = [source, target].sort().join("|") + kind;
    if (source === target || edgeKeys.has(key) || !nodes.has(source) || !nodes.has(target)) return;
    edgeKeys.add(key);
    edges.push({ source, target, kind, label });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };

  for (const c of allCategories.filter((c) => !c.archivedAt && catLinks.some((l) => l.categoryId === c.id))) {
    nodes.set(`c:${c.id}`, { id: `c:${c.id}`, kind: "category", label: c.name, href: `/${c.slug}`, group: "Topic", degree: 0 });
  }
  const tagUses = new Map<string, number>();
  for (const l of tagLinks) tagUses.set(l.tagId, (tagUses.get(l.tagId) ?? 0) + 1);
  for (const t of allTags.filter((t) => (tagUses.get(t.id) ?? 0) >= MIN_TAG_USES)) {
    nodes.set(`t:${t.id}`, { id: `t:${t.id}`, kind: "tag", label: `#${t.name}`, href: `/tag/${t.slug}`, group: "Tag", degree: 0 });
  }

  for (const r of relations) {
    if (isRelationKind(r.kind)) addEdge(r.source, r.target, r.kind, RELATION_KINDS[r.kind].label.toLowerCase());
  }
  for (const l of catLinks) addEdge(l.documentId, `c:${l.categoryId}`, "belongs_to", "belongs to");
  for (const l of tagLinks) addEdge(l.documentId, `t:${l.tagId}`, "tagged", "tagged");

  // Layout
  const width = 1200;
  const height = 820;
  const list = [...nodes.values()];
  const radius = (n: (typeof list)[number]) => (n.kind === "category" ? 10 + Math.min(10, n.degree) : n.kind === "tag" ? 4 + Math.min(4, n.degree / 2) : 5 + Math.min(7, n.degree));
  // Deterministic initial positions (golden-angle spiral) → stable layout between builds.
  const simNodes: SimNode[] = list.map((n, i) => {
    const angle = i * 2.399963;
    const dist = 12 * Math.sqrt(i + 1);
    return { id: n.id, r: radius(n), x: width / 2 + dist * Math.cos(angle), y: height / 2 + dist * Math.sin(angle) };
  });
  const links: Array<SimulationLinkDatum<SimNode>> = edges.map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(simNodes)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(60).strength(0.4))
    .force("charge", forceManyBody().strength(-90))
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6))
    .force("center", forceCenter(width / 2, height / 2))
    .force("x", forceX(width / 2).strength(0.04))
    .force("y", forceY(height / 2).strength(0.06))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();

  const pad = 40;
  const xs = simNodes.map((n) => n.x ?? 0);
  const ys = simNodes.map((n) => n.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY), 2.2);
  const byId = new Map(simNodes.map((n) => [n.id, n]));

  return {
    width,
    height,
    edges,
    nodes: list.map((n) => {
      const s = byId.get(n.id)!;
      return {
        ...n,
        r: s.r,
        x: Math.round((pad + ((s.x ?? 0) - minX) * scale + (width - pad * 2 - (maxX - minX) * scale) / 2) * 10) / 10,
        y: Math.round((pad + ((s.y ?? 0) - minY) * scale + (height - pad * 2 - (maxY - minY) * scale) / 2) * 10) / 10,
      };
    }),
  };
}
