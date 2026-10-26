import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { AwsClient } from "aws4fetch";
import { mediaConfig } from "../env";
import { ServiceError } from "../errors";
import { isValidObjectKey } from "./validation";

/** Per-request ceiling for R2 calls; the upload route allows 30 s in total (upload plus cleanup). */
const R2_TIMEOUT_MS = 10_000;

/**
 * Storage drivers behind one interface. Keys are validated on every call so
 * no caller — however buggy — can read or write outside the media namespace.
 */
export interface MediaStorage {
  readonly driver: "local" | "r2";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Reads a stored object (exports); null when it doesn't exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}

function assertKey(key: string): void {
  if (!isValidObjectKey(key)) throw new Error("Invalid media object key.");
}

export const LOCAL_MEDIA_ROOT = resolve(process.cwd(), ".data", "media");

/** Resolve a key inside the local media root, refusing anything that escapes it. */
export function localPathFor(key: string): string {
  assertKey(key);
  const full = resolve(LOCAL_MEDIA_ROOT, key);
  if (!full.startsWith(LOCAL_MEDIA_ROOT + sep)) throw new Error("Path traversal blocked.");
  return full;
}

class LocalStorage implements MediaStorage {
  readonly driver = "local" as const;
  async put(key: string, body: Buffer): Promise<void> {
    const path = localPathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  async get(key: string): Promise<Buffer | null> {
    return readLocalObject(key);
  }
  async delete(key: string): Promise<void> {
    await rm(localPathFor(key), { force: true });
  }
  urlFor(key: string): string {
    assertKey(key);
    return `/media/${key}`;
  }
}

export async function readLocalObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(localPathFor(key));
  } catch {
    return null;
  }
}

class R2Storage implements MediaStorage {
  readonly driver = "r2" as const;
  private client: AwsClient;
  constructor(
    private readonly endpoint: string,
    private readonly publicUrl: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  }
  private objectUrl(key: string): string {
    assertKey(key);
    return `${this.endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  /** Bounded, so an unreachable R2 fails fast and clearly instead of hanging the function. */
  private async send(url: string, init: RequestInit, action: string): Promise<Response> {
    try {
      return await this.client.fetch(url, { ...init, signal: AbortSignal.timeout(R2_TIMEOUT_MS) });
    } catch (error) {
      console.error(`[media] R2 ${action} failed`, error instanceof Error ? error.message : error);
      throw new ServiceError("storage_error", "Media storage is unreachable right now. Please try again in a moment.");
    }
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.send(
      this.objectUrl(key),
      {
        method: "PUT",
        body: new Uint8Array(body),
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": String(body.length),
        },
      },
      "upload",
    );
    if (!res.ok) {
      console.error(`[media] R2 upload failed with status ${res.status}`);
      throw new ServiceError("storage_error", "The file couldn't be stored. Please try again in a moment.");
    }
  }
  async get(key: string): Promise<Buffer | null> {
    const res = await this.send(this.objectUrl(key), { method: "GET" }, "download");
    if (res.status === 404) return null;
    if (!res.ok) throw new ServiceError("storage_error", "A media file couldn't be read from storage. Please try again in a moment.");
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string): Promise<void> {
    const res = await this.send(this.objectUrl(key), { method: "DELETE" }, "delete");
    if (!res.ok && res.status !== 404) throw new ServiceError("storage_error", `R2 delete failed with status ${res.status}.`);
  }
  urlFor(key: string): string {
    assertKey(key);
    return `${this.publicUrl}/${key}`;
  }
}

let instance: MediaStorage | null = null;

export function getStorage(): MediaStorage {
  if (instance) return instance;
  const config = mediaConfig();
  instance =
    config.driver === "r2"
      ? new R2Storage(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`, config.publicUrl, config.accessKeyId, config.secretAccessKey)
      : new LocalStorage();
  return instance;
}

/** For tests. */
export function setStorageForTesting(storage: MediaStorage | null): void {
  instance = storage;
}
