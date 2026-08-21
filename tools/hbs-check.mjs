#!/usr/bin/env node
/**
 * Handlebars şablon derleme kontrolü (F10 doğrulama adımı).
 *
 * `apps/api/views/**\/*.hbs` altındaki HER şablonu — sayfalar ve partial'lar — derler.
 * Amaç: `{{` çakışması, kapanmayan blok, bilinmeyen partial gibi hataları yayına gitmeden yakalamak
 * (Nest yalnız istenen sayfayı çalışma anında derler; hatalı bir sayfa ancak istenince patlar).
 *
 * Şablon motoru API ile aynı örnek: `hbs.create().handlebars` (hbs'in bağımlılığı handlebars@4.x).
 * Ayrıca partial referansları (`{{> ad}}`) views/partials altında var mı diye denetlenir.
 *
 * Kullanım: node tools/hbs-check.mjs
 * Çıkış: 0 = hepsi derlendi · 1 = en az bir şablon hatalı.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS = path.join(ROOT, 'apps', 'api', 'views');
const PARTIALS = path.join(VIEWS, 'partials');

const require = createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));
const hbs = require('hbs');
const handlebars = hbs.create().handlebars;

/** views altındaki tüm .hbs dosyaları (özyinelemeli), repo köküne göre yol. */
function listTemplates(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTemplates(full));
    else if (entry.name.endsWith('.hbs')) out.push(full);
  }
  return out.sort();
}

const templates = listTemplates(VIEWS);

/** hbs paketinin `registerPartials` adlandırması: `site-footer.hbs` → partial adı `site_footer` (hbs/lib/hbs.js). */
const partialFiles = fs.existsSync(PARTIALS) ? fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.hbs')) : [];
const partialNames = new Set(partialFiles.map((f) => f.slice(0, -4).replace(/-/g, '_')));

// Partial'lar kayıt edilir ki `{{> site_footer}}` derlemede tanınsın (main.ts ile aynı ad kuralı).
for (const file of partialFiles) {
  handlebars.registerPartial(file.slice(0, -4).replace(/-/g, '_'), fs.readFileSync(path.join(PARTIALS, file), 'utf8'));
}

const PARTIAL_REF = /\{\{>\s*([a-zA-Z0-9_/-]+)/g;

let ok = 0;
const failures = [];
const missingPartials = [];

for (const file of templates) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  try {
    // compile + precompile: ayrıştırma ve kod üretimi ayrı hata sınıfları yakalar.
    handlebars.precompile(src);
    handlebars.compile(src);
    for (const m of src.matchAll(PARTIAL_REF)) {
      const name = m[1];
      if (!partialNames.has(name)) missingPartials.push(`${rel} → {{> ${name} }}`);
    }
    ok++;
    console.log(`  ok  ${rel}`);
  } catch (err) {
    failures.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  HATA ${rel}`);
  }
}

console.log('');
console.log(`Şablon: ${ok}/${templates.length} derlendi (${templates.length - partialNames.size} sayfa + ${partialNames.size} partial)`);
if (missingPartials.length > 0) {
  console.log(`Eksik partial referansı (${missingPartials.length}):`);
  for (const m of missingPartials) console.log(`  - ${m}`);
}
if (failures.length > 0) {
  console.log(`Derlenemeyen (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length === 0 && missingPartials.length === 0 ? 0 : 1);
