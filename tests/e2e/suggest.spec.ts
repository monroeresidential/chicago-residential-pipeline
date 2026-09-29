import { expect, test, type Page } from "@playwright/test";

const FORMSPREE = "https://formspree.io/f/maenaqbd";

async function fill(page: Page) {
  const form = page.locator("#suggest-form");
  await form.getByLabel("Name").fill("Pat Broker");
  await form.getByLabel("Email").fill("pat@example.com");
  await form.getByLabel("Message").fill("Permit issued last week: https://example.com/permit");
  return form;
}

test("form lists New project plus every project, with a hidden honeypot", async ({ page, request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  await page.goto("/about");
  const options = page.locator('#suggest-form select[name="project"] option');
  await expect(options).toHaveCount(geo.features.length + 1);
  await expect(options.first()).toHaveAttribute("value", "new");
  // Playwright treats a 1px clipped element as "visible", so assert the honeypot's hiding attributes instead.
  const honeypot = page.locator('#suggest-form input[name="_gotcha"]');
  await expect(honeypot).toHaveAttribute("tabindex", "-1");
  await expect(honeypot).toHaveAttribute("aria-hidden", "true");
  await expect(honeypot).toHaveClass(/visually-hidden/);
  await expect(page.locator("#suggest-form")).toHaveAttribute("action", FORMSPREE);
});

test("?project= preselects a project; unknown values fall back to New project", async ({ page }) => {
  await page.goto("/about?project=111-w-monroe#suggest");
  await expect(page.locator('#suggest-form select[name="project"]')).toHaveValue("111-w-monroe");
  await page.goto("/about?project=bogus#suggest");
  await expect(page.locator('#suggest-form select[name="project"]')).toHaveValue("new");
});

test("successful submission posts to Formspree and thanks the user", async ({ page }) => {
  let posted = "";
  await page.route(`${FORMSPREE}`, async (route) => {
    posted = route.request().postData() ?? "";
    expect(route.request().headers()["accept"]).toContain("application/json");
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/about?project=401-w-ontario#suggest");
  const form = await fill(page);
  await form.getByRole("button", { name: "Send suggestion" }).click();
  await expect(form.locator(".form-status")).toHaveText(/we review every suggestion/);
  expect(posted).toContain("401-w-ontario");
  expect(posted).toContain("Chicago Pipeline suggestion: Birken Lofts");
  await expect(form.getByLabel("Name")).toHaveValue("");
});

test("failed submission shows an error and keeps what was typed", async ({ page }) => {
  await page.route(`${FORMSPREE}`, (route) => route.fulfill({ status: 422, contentType: "application/json", body: '{"errors":[]}' }));
  await page.goto("/about#suggest");
  const form = await fill(page);
  await form.getByRole("button", { name: "Send suggestion" }).click();
  await expect(form.locator(".form-status")).toHaveText(/didn.t send/);
  await expect(form.getByLabel("Name")).toHaveValue("Pat Broker");
  await expect(form.getByRole("button", { name: "Send suggestion" })).toBeEnabled();
});

test("footer, map sidebar and project pages link to the form", async ({ page }) => {
  await page.goto("/projects/111-w-monroe");
  await expect(page.getByRole("link", { name: "Suggest a correction to this project" })).toHaveAttribute("href", "/about?project=111-w-monroe#suggest");
  await expect(page.locator("footer").getByRole("link", { name: "Suggest a correction" })).toHaveAttribute("href", "/about#suggest");
  await page.goto("/");
  await expect(page.locator("#sidebar").getByRole("link", { name: "Suggest a correction" })).toHaveAttribute("href", "/about#suggest");
});

test("the status message is a live region that exists before submitting (so screen readers announce it)", async ({ page }) => {
  await page.goto("/about#suggest");
  const status = page.locator("#suggest-form .form-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).not.toHaveAttribute("hidden", /.*/);
  await expect(status).toHaveText("");
});

test("a network failure shows the error and keeps the input", async ({ page }) => {
  await page.route("https://formspree.io/f/maenaqbd", (route) => route.abort());
  await page.goto("/about#suggest");
  const form = await fill(page);
  await form.getByRole("button", { name: "Send suggestion" }).click();
  await expect(form.locator(".form-status")).toHaveText(/didn.t send/);
  await expect(form.getByLabel("Message")).toHaveValue(/Permit issued/);
});
