// Builds docs/index.html from latex-quickmath/0.1.0/package.yml.
//
//   npm install katex          (once, anywhere)
//   node tools/build-docs.mjs  (or: KATEX=/path/to/katex node tools/build-docs.mjs)
//
// Sections come from the "# -- Name --" comments in package.yml; the prose for
// each trigger lives in tools/meta/<section>.json. Every formula is rendered to
// MathML at build time, so the page needs no scripts, stylesheets or fonts
// beyond the ones it links itself.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const katex = (await import(process.env.KATEX ?? "katex")).default;

// ---------------------------------------------------------------- yaml ----
// package.yml is machine-uniform, so a small reader beats a dependency.

function unquote(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { out += s[i]; continue; }
    const c = s[++i];
    out += c === "n" ? "\n" : c === "t" ? "\t" : c;
  }
  return out;
}

function readMatches(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const matches = [];
  let current = null;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^\s*#\s*--\s*(.+?)\s*--\s*$/);
    if (marker) { section = marker[1]; continue; }

    const trigger = lines[i].match(/^\s*-\s+trigger:\s*"(.*)"\s*$/);
    if (trigger) {
      current = { trigger: unquote(trigger[1]), replace: "", section };
      matches.push(current);
      continue;
    }
    const inline = lines[i].match(/^\s*replace:\s*"(.*)"\s*$/);
    if (inline && current) { current.replace = unquote(inline[1]); continue; }

    if (/^\s*replace:\s*\|-?\s*$/.test(lines[i]) && current) {
      const block = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() !== "" && !/^ {6}/.test(next)) break;
        block.push(next.slice(6));
        i++;
      }
      while (block.length && block[block.length - 1].trim() === "") block.pop();
      current.replace = block.join("\n");
    }
  }
  return matches;
}

// --------------------------------------------------------------- render ----

const failures = [];

// MathML Core dropped `mathvariant`, so Chrome and Safari render KaTeX's
// <mi mathvariant="double-struck">R</mi> as a plain italic R. Swap in the real
// Unicode character instead — ℝ, 𝔤, 𝐀 — which every engine draws correctly.
const PLANES = {
  "bold": [0x1d400, 0x1d41a, 0x1d7ce],
  "italic": [0x1d434, 0x1d44e, null],
  "bold-italic": [0x1d468, 0x1d482, null],
  "script": [0x1d49c, 0x1d4b6, null],
  "bold-script": [0x1d4d0, 0x1d4ea, null],
  "fraktur": [0x1d504, 0x1d51e, null],
  "bold-fraktur": [0x1d56c, 0x1d586, null],
  "double-struck": [0x1d538, 0x1d552, 0x1d7d8],
  "sans-serif": [0x1d5a0, 0x1d5ba, 0x1d7e2],
  "bold-sans-serif": [0x1d5d4, 0x1d5ee, 0x1d7ec],
  "sans-serif-italic": [0x1d608, 0x1d622, null],
  "sans-serif-bold-italic": [0x1d63c, 0x1d656, null],
  "monospace": [0x1d670, 0x1d68a, 0x1d7f6],
};
// Letters that live outside their plane, in the Letterlike Symbols block.
const HOLES = {
  "italic": { h: 0x210e },
  "script": { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112,
              M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
  "bold-script": {},
  "fraktur": { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 },
  "double-struck": { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a,
                     R: 0x211d, Z: 0x2124 },
};

function styleChar(ch, variant) {
  const hole = HOLES[variant]?.[ch];
  if (hole) return String.fromCodePoint(hole);
  const [upper, lower, digit] = PLANES[variant];
  if (ch >= "A" && ch <= "Z") return String.fromCodePoint(upper + ch.charCodeAt(0) - 65);
  if (ch >= "a" && ch <= "z") return String.fromCodePoint(lower + ch.charCodeAt(0) - 97);
  if (digit && ch >= "0" && ch <= "9") return String.fromCodePoint(digit + ch.charCodeAt(0) - 48);
  return ch;
}

function applyVariants(mathml) {
  return mathml.replace(
    /<(mi|mn|mo|mtext)([^>]*)mathvariant="([a-z-]+)"([^>]*)>([^<]*)<\/\1>/g,
    (all, tag, pre, variant, post, body) => {
      if (!PLANES[variant]) return all; // "normal" is still honoured by browsers
      const styled = [...body].map((ch) => styleChar(ch, variant)).join("");
      return `<${tag}${pre}${post}>${styled}</${tag}>`;
    });
}

function toMathML(tex, { display }) {
  const html = katex.renderToString(tex, {
    output: "mathml", displayMode: display, throwOnError: false, strict: false,
  });
  // MathML output flags a failed parse by colouring it, not with a CSS class.
  if (html.includes("katex-error") || html.includes('mathcolor="#cc0000"')) {
    failures.push(tex);
    return "";
  }
  const math = html.match(/<math[\s\S]*<\/math>/);
  return math ? applyVariants(math[0]) : "";
}

// A replacement is a template: `$|$` is where the caret lands and runs of two
// or more spaces are the slots you tab through. Both become □ in the specimen.
function templateToTex(replace) {
  return replace
    .split("\n")
    .map((line) => {
      const indent = line.match(/^ */)[0];
      return indent + line.slice(indent.length)
        .replaceAll("$|$", "\\square")
        .replace(/ {2,}/g, " \\square ");
    })
    .join("\n")
    .trim();
}

// ----------------------------------------------------------------- data ----

const titles = {
  "brackets": "Brackets", "set-theory": "Set theory", "logic": "Logic",
  "relations": "Relations", "arrows": "Arrows", "symbols": "Symbols & spacing",
  "greek": "Greek & letters", "analysis": "Analysis", "linear-algebra": "Linear algebra",
  "algebra": "Algebra", "probability": "Probability", "decorations": "Accents & fonts",
  "delimiters": "Delimiters", "environments": "Environments",
};
const ids = new Map(Object.entries(titles).map(([id, title]) => [title, id]));

const version = "0.1.0";
const pkgDir = join(root, "latex-quickmath", version);
const pkg = join(pkgDir, "package.yml");

const manifestVersion = readFileSync(join(pkgDir, "_manifest.yml"), "utf8")
  .match(/^version:\s*"?([^"\s]+)"?/m)?.[1];
if (manifestVersion !== version) {
  console.warn(`manifest version ${manifestVersion} does not match folder ${version}`);
}

const groups = [];
const seen = new Set();
for (const m of readMatches(pkg)) {
  const id = ids.get(m.section);
  if (!id) { console.warn(`match ${m.trigger} sits under unknown section "${m.section}"`); continue; }
  if (seen.has(m.trigger)) continue; // the package ships one duplicate
  seen.add(m.trigger);

  let group = groups.find((g) => g.id === id);
  if (!group) {
    const metaFile = join(root, "tools", "meta", `${id}.json`);
    group = {
      id, title: m.section, entries: [],
      meta: existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {},
    };
    groups.push(group);
  }

  const [meaning, example, override] = group.meta[m.trigger] ?? [];
  if (!meaning) console.warn(`no metadata for ${m.trigger} (${m.section})`);
  const block = m.replace.includes("\n");
  group.entries.push({
    trigger: m.trigger.trim(),
    replace: m.replace,
    meaning: meaning ?? "",
    example: example ?? "",
    block,
    // A multi-line replacement is its own worked example; rendering the
    // snippet again underneath it would just repeat the specimen.
    specimen: toMathML(override ?? templateToTex(m.replace), { display: true }),
    rendered: example && !block ? toMathML(example, { display: false }) : "",
  });
}

const total = groups.reduce((n, g) => n + g.entries.length, 0);
if (failures.length) console.warn(`katex could not render:\n  ${failures.join("\n  ")}`);

// ----------------------------------------------------------------- html ----

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const caret = (s) => esc(s).replaceAll("$|$", '<span class="caret">$|$</span>');

const cards = (g) => g.entries.map((e, i) => `
      <article class="entry${e.block ? " entry--block" : ""}" data-id="${g.id}-${i}">
        <div class="specimen">${e.specimen}</div>
        <div class="detail">
          <button class="trigger" type="button" data-copy="${esc(e.trigger)}">${esc(e.trigger)}<span class="copy-hint" aria-hidden="true">copy</span></button>
          <p class="meaning">${esc(e.meaning)}</p>
          <pre class="repl"><code>${caret(e.replace)}</code></pre>
          ${e.example ? `<div class="example"><code>${esc(e.example)}</code>${e.rendered ? `<span class="example-out">${e.rendered}</span>` : ""}</div>` : ""}
        </div>
      </article>`).join("");

const index = groups.flatMap((g) =>
  g.entries.map((e, i) => ({
    id: `${g.id}-${i}`, g: g.id,
    t: [e.trigger, e.replace, e.meaning, e.example, g.title].join(" ").toLowerCase(),
  })));

const html = `<meta charset="utf-8">
<title>LaTeX Quickmath</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
:root{
  --paper:#f6f6fa; --card:#ffffff; --tile:#f0eff8;
  --ink:#15131f; --ink-2:#4b4761; --ink-3:#7b7694;
  --line:#e3e1ee; --line-2:#d3d0e3;
  --accent:#4c3bcf; --accent-soft:#ecebfa; --caret:#b0446a;
  --shadow:0 1px 2px rgba(21,19,31,.05), 0 8px 24px -18px rgba(21,19,31,.35);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#131221; --card:#1d1b2e; --tile:#252239;
    --ink:#edecf5; --ink-2:#b7b3cd; --ink-3:#8b86a6;
    --line:#2e2b44; --line-2:#3b3756;
    --accent:#a48fff; --accent-soft:#251f3f; --caret:#f0a0bb;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -18px rgba(0,0,0,.8);
  }
}
:root[data-theme="dark"]{
  --paper:#131221; --card:#1d1b2e; --tile:#252239;
  --ink:#edecf5; --ink-2:#b7b3cd; --ink-3:#8b86a6;
  --line:#2e2b44; --line-2:#3b3756;
  --accent:#a48fff; --accent-soft:#251f3f; --caret:#f0a0bb;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -18px rgba(0,0,0,.8);
}
*{box-sizing:border-box}
[hidden]{display:none !important}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,-apple-system,sans-serif;
  font-size:16px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1180px; margin:0 auto; padding:0 24px}
a{color:var(--accent)}
code,pre,.trigger{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
/* Leave MathML to the browser's own math font — a text face lacks the glyphs. */
math[display="block"]{margin:0}

/* ---- masthead ---- */
.masthead{padding:72px 0 40px; border-bottom:1px solid var(--line)}
.eyebrow{
  font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3); font-weight:600; margin:0 0 14px;
}
h1{
  font-family:"Source Serif 4",Georgia,serif; font-weight:600;
  font-size:clamp(38px,6vw,60px); line-height:1.04; letter-spacing:-.02em;
  margin:0 0 18px; text-wrap:balance;
}
h1 em{font-style:normal; color:var(--accent)}
.lede{
  font-family:"Source Serif 4",Georgia,serif; font-size:19px; line-height:1.6;
  color:var(--ink-2); max-width:62ch; margin:0 0 28px;
}
.legend{display:flex; flex-wrap:wrap; gap:10px 28px; font-size:13.5px; color:var(--ink-2)}
.legend div{display:flex; align-items:baseline; gap:8px}
.legend b{font-weight:500; color:var(--ink)}
.legend .caret,.legend .box{font-family:"IBM Plex Mono",monospace}
.box{color:var(--ink-3)}

/* ---- toolbar ---- */
.toolbar{
  position:sticky; top:0; z-index:20; background:var(--paper);
  background:color-mix(in srgb,var(--paper) 88%,transparent);
  backdrop-filter:blur(12px); border-bottom:1px solid var(--line); padding:14px 0;
}
.searchrow{display:flex; gap:14px; align-items:center; flex-wrap:wrap}
.field{position:relative; flex:1 1 320px}
.field svg{position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--ink-3)}
#search{
  width:100%; padding:11px 14px 11px 42px; font-size:15px; color:var(--ink);
  background:var(--card); border:1px solid var(--line-2); border-radius:9px;
  font-family:inherit;
}
#search::placeholder{color:var(--ink-3)}
#search:focus-visible{outline:2px solid var(--accent); outline-offset:1px; border-color:transparent}
.count{font-size:13px; color:var(--ink-3); font-variant-numeric:tabular-nums; white-space:nowrap}
.chips{display:flex; flex-wrap:wrap; gap:7px; padding:12px 0 2px}
.chip{
  padding:5px 12px; font-size:13px; font-family:inherit; color:var(--ink-2);
  background:transparent; border:1px solid var(--line-2); border-radius:999px; cursor:pointer;
}
.chip:hover{border-color:var(--accent); color:var(--ink)}
.chip[aria-pressed="true"]{background:var(--accent); border-color:var(--accent); color:#fff}
:root[data-theme="dark"] .chip[aria-pressed="true"]{color:#16142a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .chip[aria-pressed="true"]{color:#16142a}}
.chip:focus-visible{outline:2px solid var(--accent); outline-offset:2px}

/* ---- sections ---- */
section{padding:40px 0 8px}
.sec-head{display:flex; align-items:baseline; gap:12px; margin:0 0 18px; flex-wrap:wrap}
h2{
  font-family:"Source Serif 4",Georgia,serif; font-size:25px; font-weight:600;
  letter-spacing:-.01em; margin:0;
}
.sec-file{font-family:"IBM Plex Mono",monospace; font-size:12.5px; color:var(--ink-3)}
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:14px}

.entry{
  display:flex; gap:16px; padding:16px; background:var(--card);
  border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow);
}
.entry--block{grid-column:1 / -1}
.specimen{
  flex:0 0 92px; min-height:74px; display:flex; align-items:center; justify-content:center;
  background:var(--tile); border-radius:9px; padding:10px 12px;
  overflow-x:auto; overflow-y:hidden; scrollbar-width:thin;
  font-size:19px; color:var(--ink);
}
.entry--block .specimen{flex:0 0 auto; min-width:150px}
.detail{min-width:0; flex:1}
.trigger{
  display:inline-flex; align-items:center; gap:9px; padding:2px 8px 2px 9px; margin:0 0 7px -9px;
  font-size:14.5px; font-weight:500; color:var(--accent); background:transparent;
  border:0; border-radius:6px; cursor:pointer;
}
.trigger:hover{background:var(--accent-soft)}
.trigger:focus-visible{outline:2px solid var(--accent); outline-offset:1px}
.copy-hint{
  font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3);
  opacity:0; transition:opacity .12s ease; font-family:"IBM Plex Sans",sans-serif;
}
.trigger:hover .copy-hint,.trigger:focus-visible .copy-hint{opacity:1}
.trigger.copied .copy-hint{opacity:1; color:var(--accent)}
.meaning{
  font-family:"Source Serif 4",Georgia,serif; font-size:15.5px; line-height:1.45;
  color:var(--ink-2); margin:0 0 10px; text-wrap:pretty;
}
.repl{
  margin:0; padding:8px 10px; background:var(--tile); border-radius:7px;
  font-size:12.5px; line-height:1.5; color:var(--ink);
  white-space:pre-wrap; overflow-wrap:anywhere;
}
.caret{color:var(--caret); font-weight:500}
.example{
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  margin-top:9px; padding-top:9px; border-top:1px dashed var(--line-2);
  font-size:12.5px; color:var(--ink-3);
}
.example code{color:var(--ink-3); overflow-wrap:anywhere}
.entry--block .example code{white-space:pre-wrap; line-height:1.55}
.example-out{color:var(--ink); font-size:15px}
.example-out::before{content:"→"; color:var(--ink-3); font-size:12px; margin-right:9px}

.empty{display:none; padding:64px 0; text-align:center; color:var(--ink-2)}
.empty p{font-family:"Source Serif 4",Georgia,serif; font-size:18px; margin:0}
body.no-results .empty{display:block}

footer{
  margin-top:56px; padding:26px 0 60px; border-top:1px solid var(--line);
  font-size:13px; color:var(--ink-3); display:flex; justify-content:space-between;
  gap:16px; flex-wrap:wrap;
}
#toast{
  position:fixed; left:50%; bottom:28px; transform:translate(-50%,14px);
  padding:9px 16px; background:var(--ink); color:var(--paper); border-radius:8px;
  font-size:13.5px; opacity:0; pointer-events:none; transition:opacity .16s ease,transform .16s ease;
}
#toast.show{opacity:1; transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
@media (max-width:640px){
  .masthead{padding:44px 0 30px}
  .grid{grid-template-columns:1fr}
  .wrap{padding:0 16px}
}
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Espanso package · ${total} expansions</p>
    <h1>Type <em>:subseteq</em> — get ⊆</h1>
    <p class="lede">
      Every trigger in <b>latex-quickmath</b>, with what it means, what it expands to, and how it
      sets. Triggers fire on the trailing space, so <code>:bbR</code> only expands once you hit the
      space bar — no need to escape half-typed words.
    </p>
    <div class="legend">
      <div><span class="caret">$|$</span> <b>where the caret lands</b></div>
      <div><span class="box">□</span> <b>a slot left blank for you</b></div>
      <div><b>Click a trigger</b> to copy it</div>
      <div><b>/</b> to search</div>
    </div>
  </header>

  <div class="toolbar">
    <div class="searchrow">
      <div class="field">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
        <input id="search" type="search" autocomplete="off" spellcheck="false"
               placeholder="Search triggers, symbols, meanings — “union”, “bbR”, “derivative”">
      </div>
      <output class="count" id="count" for="search">${total} expansions</output>
    </div>
    <div class="chips" id="chips">
      <button class="chip" type="button" data-cat="all" aria-pressed="true">All</button>
      ${groups.map((g) => `<button class="chip" type="button" data-cat="${g.id}" aria-pressed="false">${g.title} <span style="opacity:.6">${g.entries.length}</span></button>`).join("\n      ")}
    </div>
  </div>

  <main>
${groups.map((g) => `    <section id="${g.id}">
      <div class="sec-head"><h2>${g.title}</h2><span class="sec-file">${g.entries.length} expansions</span></div>
      <div class="grid">${cards(g)}
      </div>
    </section>`).join("\n")}
    <div class="empty"><p>Nothing matches that. Try a symbol name, a LaTeX command, or a word from a description.</p></div>
  </main>

  <footer>
    <span>latex-quickmath ${version} · ${groups.length} sections · generated from package.yml</span>
    <span>Rendered with MathML — no scripts needed to read the maths</span>
  </footer>
</div>
<div id="toast" role="status" aria-live="polite"></div>

<script>
const INDEX = ${JSON.stringify(index)};
const nodes = new Map();
for (const el of document.querySelectorAll(".entry")) nodes.set(el.dataset.id, el);
const sections = [...document.querySelectorAll("section")];
const search = document.getElementById("search");
const count = document.getElementById("count");
const toast = document.getElementById("toast");
let category = "all";

function apply(){
  const terms = search.value.toLowerCase().split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const item of INDEX){
    const ok = (category === "all" || item.g === category) && terms.every(t => item.t.includes(t));
    nodes.get(item.id).hidden = !ok;
    if (ok) shown++;
  }
  for (const s of sections) s.hidden = !s.querySelector(".entry:not([hidden])");
  count.textContent = shown === ${total} ? "${total} expansions" : shown + " of ${total}";
  document.body.classList.toggle("no-results", shown === 0);
}

search.addEventListener("input", apply);
document.getElementById("chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  category = chip.dataset.cat;
  for (const c of document.querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c === chip));
  apply();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== search){ e.preventDefault(); search.focus(); search.select(); }
  else if (e.key === "Escape" && document.activeElement === search){ search.value = ""; apply(); search.blur(); }
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".trigger");
  if (!btn) return;
  const text = btn.dataset.copy;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  btn.classList.add("copied");
  setTimeout(() => btn.classList.remove("copied"), 900);
  toast.textContent = "Copied " + text;
  toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.classList.remove("show"), 1400);
});
</script>
`;

mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "index.html"), html);
console.log(`docs/index.html — ${total} expansions across ${groups.length} sections`);
