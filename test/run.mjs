// End-to-end test: two "phones" share one diary through a stand-in server.
// Run with: npm test   (uses the Playwright install on this machine)
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { startMock } from "./mock-server.mjs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const PORT = 8791, BASE = "http://localhost:" + PORT;
execSync("node build.mjs", { env: { ...process.env, MOCK_URL: "/api" }, stdio: "inherit" });
mkdirSync("test/out", { recursive: true });
const { server, state } = await startMock(PORT, "dist");
const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], acceptDownloads: true };
const A = await browser.newContext(phone), B = await browser.newContext(phone);
const a = await A.newPage(), b = await B.newPage();
const errors = [];
for (const [n, p] of [["A", a], ["B", b]]) { p.on("pageerror", e => errors.push(n + ": " + e.message)); p.on("dialog", d => { errors.push(n + ": unexpected browser dialog " + d.message()); d.dismiss(); }); }
let step = 0; const ok = m => console.log("  ok " + (++step) + " " + m);
const shot = (p, n) => p.screenshot({ path: "test/out/" + n + ".png", fullPage: true });
const expectText = async (p, text, ms = 6000) => { await p.getByText(text).first().waitFor({ timeout: ms }); };

try {
  // Phone A: create account and diary
  await a.goto(BASE); await shot(a, "01-sign-in");
  await a.getByText("New here? Create an account").click();
  await a.fill("#aEmail", "dad@example.com"); await a.fill("#aPass", "password123"); await a.getByRole("button", { name: "Create account" }).click();
  await a.fill("#nLabel", "Dad"); await shot(a, "02-setup"); await a.getByRole("button", { name: "Start diary" }).click();
  await expectText(a, "Event now"); ok("Dad created an account and started a diary");

  // Child details stay on the device
  await a.click('nav.tabs button[data-tab="more"]');
  await a.fill("#cName", "Sam"); await a.fill("#cDob", "2018-04-12"); await a.fill("#cNhs", "485 777 3456"); await a.fill("#cDoc", "Dr Patel");
  await a.getByRole("button", { name: "Save on this device" }).click();
  await a.getByRole("button", { name: "Make an invite code" }).click();
  const code = (await a.locator(".code").textContent()).trim(); await shot(a, "03-more-invite");
  ok("Child details saved locally, invite code " + code);

  // Phone B: partner joins
  await b.goto(BASE); await b.getByText("New here? Create an account").click();
  await b.fill("#aEmail", "mum@example.com"); await b.fill("#aPass", "password456"); await b.getByRole("button", { name: "Create account" }).click();
  await b.fill("#jCode", code.toLowerCase()); await b.fill("#jLabel", "Mum"); await b.getByRole("button", { name: "Join diary" }).click();
  await expectText(b, "Event now"); ok("Mum joined with the code");

  // A third person cannot reuse the code
  const C = await browser.newContext(phone), c = await C.newPage();
  await c.goto(BASE); await c.getByText("New here? Create an account").click();
  await c.fill("#aEmail", "nosy@example.com"); await c.fill("#aPass", "password789"); await c.getByRole("button", { name: "Create account" }).click();
  await c.fill("#jCode", code); await c.fill("#jLabel", "X"); await c.getByRole("button", { name: "Join diary" }).click();
  await expectText(c, "already been used"); await C.close(); ok("Used invite code is refused for a third account");

  // A: timed event
  await a.click('nav.tabs button[data-tab="home"]'); await shot(a, "04-home-empty");
  await a.getByText("Event now").click(); await a.waitForTimeout(2300); await shot(a, "05-timer");
  await a.getByRole("button", { name: "It's over" }).click();
  await expectText(a, "Edit event");
  await a.locator('label.chip:has(input[name="before"][value="screen"])').click();
  await a.locator('label.chip:has(input[name="signs"][value="eyelids"])').click();
  await a.locator('label.chip:has(input[name="responded"][value="no"])').click();
  await a.locator('label.chip:has(input[name="after"][value="asleep"])').click();
  await a.fill('input[name="sleptAt"]', "16:40"); await a.fill('input[name="sleptMins"]', "45");
  await a.check('input[name="video"]');
  await shot(a, "06-event-form");
  await a.getByRole("button", { name: "Save" }).click();
  await expectText(a, /Event, [0-9]+ seconds/); ok("Timed event saved with details");

  // B sees it live
  await expectText(b, /Event, [0-9]+ seconds/, 8000); ok("Mum's phone shows Dad's event without refreshing");

  // B logs a brief event, bedwetting and a day note
  await b.getByText("Brief event").click(); await shot(b, "07-brief");
  await b.getByRole("button", { name: "Think so" }).click();
  await expectText(b, "Edit event"); await b.locator('label.chip:has(input[name="before"][value="eating"])').click(); await b.getByRole("button", { name: "Save" }).click();
  await b.getByRole("button", { name: /Wet night/ }).click();
  await b.locator('label.chip:has(input[name="type"][value="soaked"])').click();
  await b.locator('label.chip:has(input[name="hardToWake"][value="yes"])').click();
  await shot(b, "08-bedwetting"); await b.getByRole("button", { name: "Save" }).click();
  await b.getByRole("button", { name: /^Woke up/ }).click(); await expectText(b, "1 logged tonight");
  await b.getByRole("button", { name: /^Dry night/ }).click();
  await expectText(b, "Dry night logged");
  await b.locator('button.k-note').click();
  await b.locator('label.chip:has(input[name="sleep"][value="poor"])').click();
  await b.fill('textarea[name="notes"]', "Late night after a party, very tired at tea time.");
  await b.getByRole("button", { name: "Save" }).click();
  // A past event, logged for Grandma
  await b.getByText("Log a past event").click();
  const wide = await b.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.querySelector(".sheet").scrollWidth, document.querySelector(".sheet").clientWidth]);
  if (wide[0] > wide[1] || wide[2] > wide[3]) throw new Error("Past event form is wider than the screen: " + wide.join(","));
  const past = new Date(Date.now() - 3 * 864e5); past.setHours(8, 15, 0, 0);
  const p2 = n => String(n).padStart(2, "0");
  await b.fill('input[name="when"]', past.getFullYear() + "-" + p2(past.getMonth() + 1) + "-" + p2(past.getDate()) + "T08:15");
  await b.locator('label.chip:has(input[name="duration"][value="long"])').click();
  await b.locator('label.chip:has(input[name="certainty"][value="definite"])').click();
  await b.locator('label.chip:has(input[name="seenBy"][value="Grandparent"])').click();
  await b.locator('label.chip:has(input[name="after"][value="tired"])').click();
  await b.getByRole("button", { name: "Save" }).click();
  await shot(b, "09-home-b");
  await expectText(a, "Bedwetting, soaked through", 8000); await expectText(a, "Day note", 8000); await expectText(a, "Dry night logged", 8000); await expectText(a, "Woke up", 8000); ok("Brief event opens its details straight away; Dad sees Mum's brief event, waking, wet night, dry night and day note; past event form fits the screen");

  // Offline on A
  await A.setOffline(true);
  await a.getByText("Brief event").click(); await a.getByRole("button", { name: "Not sure" }).click(); await a.getByRole("button", { name: "Close" }).click();
  await expectText(a, "1 waiting to sync"); await shot(a, "10-offline");
  ok("Offline entry saved on the phone and marked as waiting");
  await A.setOffline(false); await a.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectText(a, "Synced", 8000);
  await b.waitForFunction(() => document.body.innerText.includes("Not sure"), null, { timeout: 8000 }); ok("Once back online it synced to Mum's phone");

  // Server has no child name
  const blob = JSON.stringify(state);
  if (/Sam|2018-04-12|485 777|Patel/.test(blob)) throw new Error("Child details leaked to the server");
  ok("Server data contains no name, date of birth, NHS number or doctor");

  // Edit and delete propagate
  await b.click('nav.tabs button[data-tab="diary"]'); await shot(b, "11-diary");
  await b.locator(".entry", { hasText: "Not sure" }).first().click();
  await b.getByRole("button", { name: "Delete this entry" }).click();
  await b.locator("#askYes").click();
  await a.waitForFunction(() => !document.body.innerText.includes("Not sure"), null, { timeout: 8000 }); ok("Deleting on one phone removes it on the other");

  // Child details appear only on A's titles
  if (!(await a.textContent("#title")).includes("Sam")) throw new Error("Title missing name on A");
  if ((await b.textContent("#title")).includes("Sam")) throw new Error("B should not know the name");
  ok("Name shows on Dad's phone only, until Mum enters it");

  // Report
  await a.click('nav.tabs button[data-tab="report"]'); await shot(a, "12-report");
  const [dl] = await Promise.all([a.waitForEvent("download"), a.getByRole("button", { name: "Make PDF report" }).click()]);
  await dl.saveAs("test/out/report.pdf"); ok("PDF made: " + dl.suggestedFilename());

  // Daily backup on the device, and restore brings back the deleted entry
  await a.click('nav.tabs button[data-tab="more"]');
  await expectText(a, "Backups on this device"); await a.locator('[data-act="restore"]').first().click(); await a.locator("#askYes").click();
  await expectText(a, "Backup restored"); await shot(a, "13-backups");
  await b.waitForFunction(() => document.body.innerText.includes("Not sure"), null, { timeout: 8000 }); ok("Daily backup kept on the phone; restoring it brought the deleted entry back for both");
  // No page is wider than a small phone screen
  for (const t of ["home", "diary", "report", "more"]) { await b.click('nav.tabs button[data-tab="' + t + '"]'); const w = await b.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (w > 0) throw new Error(t + " tab is " + w + "px too wide"); }
  ok("No tab scrolls sideways");

  // Reload keeps sign-in and data
  await a.reload(); await expectText(a, /Event, [0-9]+ seconds/); ok("Reload keeps you signed in with your entries");

  if (errors.length) throw new Error("Page errors:\n" + errors.join("\n"));
  console.log("\nAll " + step + " checks passed.");
} catch (e) {
  console.error("\nFAILED at step " + (step + 1) + ": " + e.message);
  await shot(a, "fail-a").catch(() => {}); await shot(b, "fail-b").catch(() => {});
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally { await browser.close(); server.close(); }
