/**
 * Zero-install local PostgreSQL.
 *
 * Runs PGlite (real Postgres compiled to WebAssembly) behind a Postgres wire
 * protocol socket, persisted in ./.data/pglite. The app connects to it with
 * the same postgres.js driver it uses for Supabase in production, so local
 * development exercises the exact production code path.
 *
 *   npm run db:local      # keep running in its own terminal
 *
 * DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, connect, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const backendPort = port + 1;
const host = "127.0.0.1";
const dataDir = resolve(process.env.LOCAL_DB_DIR ?? ".data/pglite");
const snapshotDir = resolve(process.env.LOCAL_DB_SNAPSHOTS ?? ".data/pglite-snapshots");
const SNAPSHOTS_KEPT = 5;
const STARTUP_SNAPSHOT_EVERY_MS = 60 * 60 * 1000;

/** True when something already accepts connections on the port. */
function portInUse(target: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = connect(target, host);
    probe.once("connect", () => {
      probe.destroy();
      done(true);
    });
    probe.once("error", () => done(false));
  });
}

function listSnapshots(): string[] {
  if (!existsSync(snapshotDir)) return [];
  return readdirSync(snapshotDir)
    .filter((f) => /^pglite-.*\.tar\.gz$/.test(f))
    .sort();
}

/**
 * A consistent copy of the data directory, taken through PGlite itself after a
 * CHECKPOINT. Copying `.data/pglite` with `cp` while the server runs is not
 * consistent (every hand-made backup in .data/ carries a live postmaster.pid).
 * Restore: tar -xzf <snapshot> -C .data/pglite (into an empty directory).
 */
async function snapshot(db: PGlite, { onlyIfOlderThanMs }: { onlyIfOlderThanMs?: number } = {}) {
  const existing = listSnapshots();
  const newest = existing.at(-1);
  if (onlyIfOlderThanMs && newest && Date.now() - statSync(join(snapshotDir, newest)).mtimeMs < onlyIfOlderThanMs) return;
  mkdirSync(snapshotDir, { recursive: true });
  await db.exec("CHECKPOINT");
  const archive = await db.dumpDataDir("gzip");
  const name = `pglite-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  writeFileSync(join(snapshotDir, name), Buffer.from(await archive.arrayBuffer()));
  for (const old of existing.slice(0, Math.max(0, existing.length + 1 - SNAPSHOTS_KEPT))) rmSync(join(snapshotDir, old), { force: true });
  console.log(`Snapshot saved: ${join(snapshotDir, name)}`);
}

function explainUnreadable(error: unknown): never {
  const snapshots = listSnapshots();
  console.error(error);
  console.error(`\nThe local database in ${dataDir} could not be opened (see above).`);
  console.error("This is the failure that makes every page show \"The site hit an unexpected problem\".");
  console.error("Keep the broken folder (rename it, do not delete it), then restore:");
  if (snapshots.length) {
    console.error(`  mkdir .data/pglite && tar -xzf ${join(snapshotDir, snapshots.at(-1)!)} -C .data/pglite`);
  } else {
    console.error("  copy the newest backup folder from .data/ to .data/pglite, or start empty and run: npm run db:setup");
  }
  console.error("then run: npm run db:migrate");
  process.exit(1);
}

/**
 * PGlite is a single session. Its socket server serialises individual socket
 * chunks, not whole extended-protocol query cycles, so two live connections
 * can interleave Parse/Bind messages — and above its connection limit Node
 * simply resets new sockets. This front door accepts every client and hands
 * the database to one connection at a time; the rest wait in FIFO order
 * (their startup bytes stay buffered until their turn). Clients should use a
 * pool of 1 with a short idle timeout so the turn passes quickly (see
 * .env.example). Local development only — Supabase needs none of this.
 */
function startQueue() {
  const waiting: Socket[] = [];
  let active: Socket | null = null;

  const next = () => {
    if (active) return;
    let client = waiting.shift();
    while (client?.destroyed) client = waiting.shift();
    if (!client) return;
    active = client;
    const turn = client;
    const backend = connect(backendPort, host);
    backend.setNoDelay(true);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      turn.destroy();
      backend.destroy();
      // Give the backend a moment to register the close before the next turn.
      setTimeout(() => {
        if (active === turn) active = null;
        next();
      }, 25);
    };
    turn.pipe(backend);
    backend.pipe(turn);
    for (const socket of [turn, backend]) {
      socket.on("close", finish);
      socket.on("error", finish);
    }
  };

  const front = createServer((socket) => {
    socket.setNoDelay(true);
    socket.on("error", () => socket.destroy());
    waiting.push(socket);
    next();
  });
  return new Promise<typeof front>((resolveServer, reject) => {
    front.once("error", reject);
    front.listen(port, host, () => resolveServer(front));
  });
}

async function main() {
  // PGlite does not lock its data directory: a second process opening it while
  // this one runs would write to the same files. Refuse before touching them.
  if ((await portInUse(port)) || (await portInUse(backendPort))) {
    console.error(`A local database is already running on ${host}:${port}. Not starting a second copy (two processes on one data directory corrupt it). Use the running one.`);
    process.exit(1);
  }
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(join(dataDir, "postmaster.pid"))) console.warn("The previous run did not shut down cleanly; PostgreSQL will recover from its log.");
  let db: PGlite;
  try {
    db = await PGlite.create(dataDir, { extensions: { pg_trgm } });
  } catch (error) {
    explainUnreadable(error);
  }
  // Two slots so a just-closed turn can't cause a reset; the queue above
  // guarantees only one of them is ever in use.
  const server = new PGLiteSocketServer({ db, port: backendPort, host, maxConnections: 2 });
  await server.start();
  const front = await startQueue();
  console.log(`Local Postgres (PGlite) listening on postgres://postgres@${host}:${port}/postgres`);
  console.log(`Data directory: ${dataDir}`);

  // The database opened, so this state is readable: keep a restorable copy.
  await snapshot(db, { onlyIfOlderThanMs: STARTUP_SNAPSHOT_EVERY_MS }).catch((error: unknown) => console.warn("Snapshot skipped:", error instanceof Error ? error.message : error));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nShutting down local database…");
    front.close();
    await server.stop();
    await snapshot(db).catch((error: unknown) => console.warn("Snapshot skipped:", error instanceof Error ? error.message : error));
    await db.close();
    process.exit(0);
  };
  // Windows delivers SIGBREAK (Ctrl+Break) and SIGHUP (terminal window closed) instead of SIGTERM.
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) process.on(signal, () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
