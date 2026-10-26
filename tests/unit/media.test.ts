import zlib from "node:zlib";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { fetchLinkPreview, isBlockedAddress, parsePreview } from "@/server/services/link-preview";
import { maxUploadBytes } from "@/server/services/media";
import { processImage, ImageProcessingError } from "@/server/media/processing";
import { localPathFor } from "@/server/media/storage";
import { buildObjectKey, isValidObjectKey, MAX_BYTES, sanitizeFilename, sniffType, validateUpload } from "@/server/media/validation";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const ascii = (s: string) => new Uint8Array([...Buffer.from(s), ...new Array(16).fill(0)]);

describe("file signature sniffing", () => {
  it("detects allowed types from bytes", () => {
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe("image/png");
    expect(sniffType(ascii("GIF89a"))?.mime).toBe("image/gif");
    expect(sniffType(ascii("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffType(ascii("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniffType(ascii("ID3"))?.mime).toBe("audio/mpeg");
  });

  it.each([
    ["SVG", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ["XML-prefixed SVG", '<?xml version="1.0"?><svg/>'],
    ["HTML", "<!doctype html><script>alert(1)</script>"],
    ["shell script", "#!/bin/sh\nrm -rf /"],
    ["Windows executable", "MZ\x90\x00\x03"],
  ])("rejects %s", (_, content) => {
    expect(sniffType(ascii(content))).toBeNull();
  });

  it("rejects a MIME-spoofed upload (HTML declared as image/png)", () => {
    const result = validateUpload(ascii("<html><script>alert(1)</script></html>"), "image/png");
    expect(result.ok).toBe(false);
  });

  it("rejects a PDF declared as an image (family mismatch)", () => {
    const result = validateUpload(ascii("%PDF-1.4 fake"), "image/jpeg");
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("enforces size limits", () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateUpload(big, "image/png", 1024 * 1024)).toMatchObject({ ok: false, status: 413 });
  });
});

describe("upload size limit", () => {
  const original = process.env.MAX_UPLOAD_MB;
  afterEach(() => {
    if (original === undefined) delete process.env.MAX_UPLOAD_MB;
    else process.env.MAX_UPLOAD_MB = original;
  });

  it("defaults to 4 MB when unset (Vercel's request body limit is ~4.5 MB)", () => {
    delete process.env.MAX_UPLOAD_MB;
    expect(maxUploadBytes()).toBe(4 * 1024 * 1024);
  });

  it("honors a valid MAX_UPLOAD_MB override", () => {
    process.env.MAX_UPLOAD_MB = "10";
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
  });

  it("ignores invalid overrides and falls back to the 4 MB default", () => {
    for (const bad of ["0", "-5", "not-a-number", ""]) {
      process.env.MAX_UPLOAD_MB = bad;
      expect(maxUploadBytes()).toBe(4 * 1024 * 1024);
    }
  });

  it("never exceeds the highest per-kind ceiling, even if misconfigured", () => {
    process.env.MAX_UPLOAD_MB = "9999";
    expect(maxUploadBytes()).toBe(Math.max(...Object.values(MAX_BYTES)));
  });
});

describe("object keys and filenames", () => {
  it("only server-generated keys are valid", () => {
    const key = buildObjectKey("image", "33333333-3333-4333-8333-333333333333", "webp", "-w960", new Date("2026-09-12"));
    expect(key).toBe("media/2026/09/33333333-3333-4333-8333-333333333333-w960.webp");
    expect(isValidObjectKey(key)).toBe(true);
    for (const bad of ["../../etc/passwd", "media/2026/09/../../../x.webp", "media/2026/09/abc.webp", "media/2026/09/33333333-3333-4333-8333-333333333333.html", "/abs/path.webp"]) {
      expect(isValidObjectKey(bad)).toBe(false);
    }
  });

  it("refuses local paths outside the media root", () => {
    expect(() => localPathFor("../../secrets.txt")).toThrow();
    expect(() => localPathFor("media/2026/09/..%2f..%2fx.webp")).toThrow();
  });

  it("sanitises display filenames", () => {
    expect(sanitizeFilename("../../evil<script>.png")).toBe("evilscript.png");
    expect(sanitizeFilename("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("image processing", () => {
  it("re-encodes to WebP, generates variants and strips metadata (EXIF/GPS)", async () => {
    const input = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 80, b: 40 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-location-owner" } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processImage(input);
    const meta = await sharp(out.primary.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(out.primary.width).toBe(1600);
    expect(out.variants.map((v) => v.width)).toEqual([480, 960, 1440]);
    expect(out.placeholder.startsWith("data:image/webp;base64,")).toBe(true);
    expect(out.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("rejects bytes that only pretend to be an image", async () => {
    const polyglot = Buffer.concat([Buffer.from("GIF89a"), Buffer.from("<script>alert(1)</script>")]);
    await expect(processImage(polyglot)).rejects.toBeInstanceOf(ImageProcessingError);
  });

  it("rejects decompression bombs", async () => {
    // A ~60-byte PNG whose header claims 20000×20000 pixels (400 MP) must never be decoded.
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(body));
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(20000, 0);
    ihdr.writeUInt32BE(20000, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(Buffer.alloc(10))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    await expect(processImage(bomb)).rejects.toBeInstanceOf(ImageProcessingError);
  });
});

describe("SSRF protection for link previews", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::7f00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001::1",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it("allows public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
  });
  // IP-literal hosts never reach the DNS lookup hook, so they must be refused up front.
  it.each(["http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "https://10.0.0.1/"])(
    "refuses the IP-literal URL %s before connecting",
    async (url) => {
      await expect(fetchLinkPreview({ kind: "admin", userId: "u", login: "owner" }, url)).rejects.toThrow("That address is not allowed.");
    },
  );
  it("parses Open Graph metadata without executing anything", () => {
    const preview = parsePreview('<html><head><title>Fallback</title><meta property="og:title" content="Real &amp; Title"><meta name="description" content="Desc"></head><script>alert(1)</script></html>', "https://www.example.com/x");
    expect(preview).toEqual({ url: "https://www.example.com/x", title: "Real & Title", description: "Desc", siteName: "example.com" });
  });

  it("reads meta tags whatever the attribute order or quote style", () => {
    const html = `<meta content='Single quoted' name='description'><meta content="It's fine" property="og:title"><meta CONTENT="Site" Property="og:site_name">`;
    expect(parsePreview(html, "https://example.com/")).toEqual({ url: "https://example.com/", title: "It's fine", description: "Single quoted", siteName: "Site" });
  });

  it("keeps a quoted value that contains > or <, and a long <title>", () => {
    const html = `<meta name="description" content="A -> B and x < y"><title>${"t".repeat(1500)}</title>`;
    const preview = parsePreview(html, "https://example.com/");
    expect(preview.description).toBe("A -> B and x < y");
    expect(preview.title).toBe("t".repeat(300));
  });

  it("stays fast on a hostile page of unterminated tags (the old patterns took seconds)", () => {
    // 200 KB, the most the parser ever looks at. Unbounded `[^>]+` patterns are quadratic on this input.
    const shapes = [`<meta ${"w".repeat(1990)}>`, "<meta ","<title ", '<meta property="og:title" ', `<meta ${"a=".repeat(900)}`, `<meta x="${"y".repeat(1900)}`, `<meta '<meta "`, `<meta ${"w".repeat(1990)} `];
    for (const tag of shapes) {
      const html = tag.repeat(Math.ceil(200_000 / tag.length));
      const started = performance.now();
      parsePreview(html, "https://example.com/");
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
