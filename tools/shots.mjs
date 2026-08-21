// Site + admin ekran görüntüleri (masaüstü + mobil)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const SITE = "http://127.0.0.1:4010";
const ADMIN = "http://localhost:4011";
const EMAIL = process.argv[3];
const PASS = process.argv[4];
fs.mkdirSync(OUT, { recursive: true });

const SITE_PAGES = [
  ["01-anasayfa", "/index.html"],
  ["02-urunler", "/urunler.html"],
  ["03-urun-detay", "/urun.html?id=zeytinyagi"],
  ["04-kutu", "/kutu.html?tier=sezon"],
  ["05-sepet", "/sepet.html"],
  ["06-uyelik", "/uyelik.html"],
  ["07-gunluk", "/gunluk.html"],
  ["08-toptan", "/toptan.html"],
  ["09-politikalar", "/politikalar.html"],
  ["10-nasil-seciyoruz", "/nasil-seciyoruz.html"],
];
const ADMIN_PAGES = [
  ["a1-ozet", "/"],
  ["a2-urunler", "/urunler"],
  ["a3-haftanin-kutusu", "/haftanin-kutusu"],
  ["a4-siparisler", "/siparisler"],
  ["a5-abonelikler", "/abonelikler"],
  ["a6-teslimat-gunu", "/teslimat-gunu"],
  ["a7-icerik", "/icerik"],
  ["a8-ayarlar", "/ayarlar"],
  ["a9-sistem", "/sistem"],
  ["a10-medya", "/medya"],
];

async function shoot(page, url, file, full = true) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, file + ".png"), fullPage: full });
}

const browser = await chromium.launch();
try {
  // --- site: masaüstü ---
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await desk.newPage();
  for (const [name, url] of SITE_PAGES) {
    await shoot(p, SITE + url, name);
    console.log("site ✓", name);
  }
  await desk.close();

  // --- site: mobil (ilk 4 sayfa) ---
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const pm = await mob.newPage();
  for (const [name, url] of SITE_PAGES.slice(0, 4)) {
    await shoot(pm, SITE + url, "m-" + name);
    console.log("mobil ✓", name);
  }
  await mob.close();

  // --- admin: girişli ---
  const adm = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pa = await adm.newPage();
  await pa.goto(ADMIN + "/login", { waitUntil: "networkidle", timeout: 45000 });
  await shoot(pa, ADMIN + "/login", "a0-giris", false);
  await pa.fill('input[type="email"], input[name="email"]', EMAIL);
  await pa.fill('input[type="password"], input[name="password"]', PASS);
  await Promise.all([
    pa.waitForURL((u) => !String(u).includes("/login"), { timeout: 30000 }).catch(() => {}),
    pa.click('button[type="submit"]'),
  ]);
  await pa.waitForTimeout(1500);
  const loggedIn = !pa.url().includes("/login");
  console.log("admin giriş:", loggedIn ? "OK" : "BAŞARISIZ (" + pa.url() + ")");
  if (loggedIn) {
    for (const [name, url] of ADMIN_PAGES) {
      await shoot(pa, ADMIN + url, name);
      console.log("admin ✓", name);
    }
  }
  await adm.close();
} finally {
  await browser.close();
}
const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"));
console.log("\ntoplam görüntü:", files.length, "→", OUT);
