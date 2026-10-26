import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("Studio saves, previews, publishes and withdraws a long article", async ({ page, browser, baseURL }, testInfo) => {
  await page.goto("/admin/login");
  await page.getByRole("button", { name: "Local development sign-in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Desk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Article", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/documents\/[\w-]+$/);
  const documentId = page.url().split("/").at(-1)!;
  const endpoint = `**/api/admin/documents/${documentId}`;
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Document settings" })).toHaveCount(0);
  const title = `Library QA ${Date.now()}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  const paragraph = "A useful personal library makes the relationship between ideas visible without forcing every reader through a chronological feed. Clear headings let someone scan before committing to a longer read. Short summaries provide enough context to choose a useful next step. Stable typography and a comfortable reading measure help the page stay calm when the subject becomes complicated. An author should be able to revise a thought privately and publish deliberately. These paragraphs are local test material, written to exercise the interface rather than describe a person or their achievements.";
  const html = Array.from({ length: 8 }, (_, index) => `<h2>Reading practice ${index + 1}</h2>${Array.from({ length: 5 }, () => `<p>${paragraph}</p>`).join("")}`).join("")
    + `<h2>Structured examples</h2><blockquote><p>Clarity begins with a useful question.</p></blockquote><ul><li>Read deliberately</li><li>Follow a topic</li></ul><ol><li>Capture an idea</li><li>Revise before publishing</li></ol><pre><code>const message = '${"long-code-value-".repeat(30)}';</code></pre><table><tbody><tr><th>Check</th><th>Result</th></tr><tr><td>Privacy</td><td>Drafts stay private</td></tr></tbody></table><p><a href="https://www.w3.org/WAI/standards-guidelines/wcag/">Accessibility guidance</a></p>`;
  await body.focus();
  await body.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", content);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, html);
  expect((await body.innerText()).split(/\s+/).length).toBeGreaterThan(3000);
  await expect(page.getByText("Unsaved changes from", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("status").first()).toContainText(/Saved|All changes saved/);

  await body.focus();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  const image = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#287055" } }).png().toBuffer();
  await page.getByLabel("Upload file", { exact: true }).setInputFiles({ name: "local-qa-swatch.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("dialog", { name: "Choose an image" })).toHaveCount(0);
  await page.getByPlaceholder("What does the image show?").fill("Green swatch used only for local image QA");
  await page.getByPlaceholder("Optional caption", { exact: true }).fill("Local QA image, not a portfolio asset.");
  await expect(page.getByRole("status").first()).toContainText(/Saved|All changes saved/);

  let releaseSave: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let saving = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "PATCH") {
      saving = true;
      await gate;
    }
    await route.continue();
  });
  await page.getByRole("textbox", { name: "Excerpt", exact: true }).fill("An earlier save in flight.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => saving).toBe(true);
  await page.getByRole("textbox", { name: "Excerpt", exact: true }).fill("Latest saved preview: a local-only quality check.");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Preview document" }).click();
  const preview = await popup;
  await expect(preview).toHaveURL("about:blank");
  releaseSave();
  await expect(preview).toHaveURL(new RegExp(`/preview/${documentId}$`));
  await expect(preview.getByText("Latest saved preview: a local-only quality check.", { exact: true }).first()).toBeVisible();
  await preview.close();
  await page.unroute(endpoint);

  const publication = page.waitForResponse((response) => response.url().endsWith(`/${documentId}/actions`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await publication;
  expect(published.ok()).toBe(true);
  const { path } = await published.json() as { path: string };
  await expect(page.getByRole("link", { name: "View live page" })).toHaveAttribute("href", path);

  const anonymous = await browser.newContext({ baseURL, colorScheme: "light" });
  const reader = await anonymous.newPage();
  const response = await reader.goto(path);
  expect(response?.status()).toBe(200);
  await expect(reader.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(reader.locator("table")).toHaveCount(1);
  await expect(reader.locator("pre")).toHaveCount(1);
  const layout = [];
  for (const width of [320, 390, 768, 1440]) {
    await reader.setViewportSize({ width, height: 900 });
    const dimensions = await reader.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    layout.push(dimensions);
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
    await reader.screenshot({ path: testInfo.outputPath(`reading-${width}.png`) });
  }
  await reader.emulateMedia({ colorScheme: "dark" });
  await reader.reload();
  await reader.screenshot({ path: testInfo.outputPath("reading-dark.png") });
  const publishedImage = reader.getByRole("img", { name: "Green swatch used only for local image QA", exact: true });
  await publishedImage.scrollIntoViewIfNeeded();
  await expect.poll(() => publishedImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(reader.getByText("Local QA image, not a portfolio asset.", { exact: true })).toBeVisible();
  await publishedImage.screenshot({ path: testInfo.outputPath("published-image.png") });
  await testInfo.attach("layout", { body: JSON.stringify(layout), contentType: "application/json" });

  await page.getByRole("textbox", { name: "Excerpt", exact: true }).fill("A staged revision that is not public yet.");
  await expect(page.getByRole("status").first()).toContainText("staged");
  await reader.reload();
  await expect(reader.getByText("A staged revision that is not public yet.", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(body).toBeVisible();
  expect((await body.innerText()).split(/\s+/).length).toBeGreaterThan(3000);
  await expect(page.getByRole("textbox", { name: "Excerpt", exact: true })).toHaveValue("A staged revision that is not public yet.");
  await expect(page.getByText("Unsaved changes from", { exact: false })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await page.getByRole("button", { name: "Open studio menu" }).click();
  await expect(page.getByRole("dialog", { name: "Studio sidebar" })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close studio menu" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open studio menu" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("studio-mobile.png") });

  await page.getByRole("button", { name: "Show details panel" }).click();
  const settings = page.getByRole("dialog", { name: "Document settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("End");
  await expect(settings.getByRole("tab", { name: "Notes", exact: true })).toBeFocused();
  await expect(settings.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(settings.getByRole("tab", { name: "Properties", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show details panel" })).toBeFocused();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unpublish (back to draft)" }).click();
  await expect(page.getByText(/^Not on the site yet\. Publish makes it: live and listed across the site/).first()).toBeVisible();
  expect((await reader.goto(path))?.status()).toBe(404);
  expect((await anonymous.request.get(`/api/admin/documents/${documentId}`)).status()).toBe(401);
  expect((await anonymous.request.get(`/preview/${documentId}`, { maxRedirects: 0 })).status()).toBe(307);
  await anonymous.close();
});

test("public routes reflow and expose useful Library search", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const vitals = { lcpMs: 0, layoutShift: 0 };
    Object.defineProperty(window, "__libraryVitals", { value: vitals });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) vitals.lcpMs = Math.round(entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) vitals.layoutShift += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const metrics: unknown[] = [];
  for (const path of ["/", "/library", "/topics", "/search?q=Library", "/about", "/missing-library-qa-page"]) {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(path);
      expect(response?.status()).toBe(path.includes("missing-library") ? 404 : 200);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await expect(page.locator("main h1")).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`${(path.split("?")[0] ?? "home").replaceAll("/", "_")}-${width}.png`) });
      metrics.push(await page.evaluate(({ path, width }) => {
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const vitals = (window as typeof window & { __libraryVitals: { lcpMs: number; layoutShift: number } }).__libraryVitals;
        return { path, width, ...vitals, ttfbMs: Math.round(navigation.responseStart), domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd), transferredBytes: navigation.transferSize + resources.reduce((total, resource) => total + resource.transferSize, 0), javascriptBytes: resources.filter((resource) => resource.name.includes(".js")).reduce((total, resource) => total + resource.encodedBodySize, 0) };
      }, { path, width }));
    }
  }
  // Retired routes land on their replacements.
  await page.goto("/explore");
  await expect(page).toHaveURL(/\/library$/);
  await page.goto("/graph");
  await expect(page).toHaveURL(/\/topics$|\/library$|missing/);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "The Library", exact: true })).toBeVisible();
  // Exactly one primary menu item is current.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('nav[aria-label="Primary"] [aria-current="page"]')).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search the library", exact: true }).fill("Library");
  await page.locator("main").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=Library/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect((await page.goto("/library/page/9999"))?.status()).toBe(404);

  // Automated WCAG 2.2 A/AA checks (axe-core) in both themes. Not a substitute for manual review.
  const violations: Record<string, string[]> = {};
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => localStorage.setItem("theme", t), theme);
    for (const path of ["/", "/library", "/topics", "/search?q=Library", "/about"]) {
      await page.goto(path);
      await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
      const found = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe;
        const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
      });
      if (found.length) violations[`${theme} ${path}`] = found;
    }
  }
  expect(violations).toEqual({});
  expect(errors).toEqual([]);
  await testInfo.attach("public-route-metrics", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
  console.info("Public-route lab metrics:", JSON.stringify(metrics));
});