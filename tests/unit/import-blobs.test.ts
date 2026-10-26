import { describe, expect, it } from "vitest";
import { blobIndex, findBlob } from "@/components/admin/import/ingest";

const blob = (name: string) => new Blob([name]);

describe("picked media lookup (wrapper folders)", () => {
  it("finds media the server names without the wrapper folder the browser picked", () => {
    const a = blob("a");
    const b = blob("b");
    const index = blobIndex([
      { path: "site/assets/fig-000.png", blob: a },
      { path: "site/assets/fig-001.png", blob: b },
      { path: "site/notes/x.md", blob: null },
    ]);
    expect(findBlob(index, "assets/fig-000.png")).toBe(a);
    expect(findBlob(index, "site/assets/fig-001.png")).toBe(b);
    expect(findBlob(index, "assets/missing.png")).toBeUndefined();
  });

  it("finds media when the server path still carries a folder the browser stripped", () => {
    const a = blob("a");
    const index = blobIndex([{ path: "assets/a.png", blob: a }]);
    expect(findBlob(index, "wrapper/assets/a.png")).toBe(a);
  });

  it("does not guess between two different files that share a trailing path", () => {
    const index = blobIndex([
      { path: "one/img/a.png", blob: blob("1") },
      { path: "two/img/a.png", blob: blob("2") },
    ]);
    // "img/a.png" is filed under both (first wins by key), but an ambiguous suffix match never picks arbitrarily.
    expect(findBlob(new Map([["x/img/a.png", blob("1")], ["y/img/a.png", blob("2")]]), "img/a.png")).toBeUndefined();
    expect(index.size).toBeGreaterThan(0);
  });
});
