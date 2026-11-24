/**
 * Funções injetadas na aba com chrome.scripting.executeScript.
 * Cada função precisa ser autocontida (sem variáveis de fora), porque o
 * navegador serializa só o corpo dela. Nada aqui envia dados para fora.
 */

/** Lê a página (mundo isolado): texto, tabelas, listas, links, títulos e metadados. */
export function extractPageRaw() {
  const clip = (s, n = 500) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const tables = [...document.querySelectorAll("table")].slice(0, 30).map((t) =>
    [...t.rows].slice(0, 500).map((r) => [...r.cells].slice(0, 30).map((c) => clip(c.innerText, 300))));
  const lists = [...document.querySelectorAll("ul, ol")]
    .filter((l) => !l.closest("nav, header, footer") && l.children.length >= 2)
    .slice(0, 50)
    .map((l) => [...l.children].filter((li) => li.tagName === "LI").slice(0, 300).map((li) => clip(li.innerText, 300)).filter(Boolean))
    .filter((items) => items.length);
  const seen = new Set();
  const links = [];
  const mailtos = [];
  const tels = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    if (href.startsWith("mailto:")) { mailtos.push(decodeURIComponent(href.slice(7).split("?")[0])); continue; }
    if (href.startsWith("tel:")) { tels.push(decodeURIComponent(href.slice(4))); continue; }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: clip(a.innerText || a.title || a.getAttribute("aria-label"), 200), href });
    if (links.length >= 2000) break;
  }
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].slice(0, 300)
    .map((h) => ({ level: Number(h.tagName[1]), text: clip(h.innerText, 300) })).filter((h) => h.text);
  const meta = {};
  for (const m of document.querySelectorAll("meta[name], meta[property]")) {
    const key = m.getAttribute("name") || m.getAttribute("property");
    if (/^(description|keywords|author|og:|twitter:|robots|generator)/i.test(key)) meta[key] = clip(m.content, 300);
  }
  const canonical = document.querySelector("link[rel=canonical]")?.href;
  if (canonical) meta.canonical = canonical;
  const contentType = document.contentType || "";
  const bodyText = document.body ? document.body.innerText : "";
  return {
    title: document.title,
    url: location.href,
    lang: document.documentElement.lang || "",
    contentType,
    meta,
    tables,
    lists,
    links,
    mailtos,
    tels,
    headings,
    images: document.images.length,
    text: bodyText.slice(0, 400000),
    selection: String(window.getSelection() || "").trim().slice(0, 4000),
    generatedAt: new Date().toISOString(),
  };
}

/** Aplica ou remove o CSS do design (mundo isolado). Só mexe num <style> próprio. */
export function applyDesignCss(css) {
  const id = "mestre-do-pc-design";
  let el = document.getElementById(id);
  if (!css) { el?.remove(); return false; }
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    (document.head || document.documentElement).appendChild(el);
  }
  el.textContent = css;
  return true;
}

/** Mundo MAIN: começa a guardar erros do console a partir de agora. */
export function installDevHook() {
  if (window.__mestreDevHook) return { installed: false, errors: window.__mestreDevHook.errors.length };
  const errors = [];
  const push = (kind, msg) => { if (errors.length < 200) errors.push({ kind, msg: String(msg).slice(0, 500), at: Date.now() }); };
  const original = console.error;
  console.error = function (...args) {
    push("console.error", args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : a)).join(" "));
    return original.apply(this, args);
  };
  window.addEventListener("error", (e) => push("erro", `${e.message} (${e.filename || ""}:${e.lineno || ""})`));
  window.addEventListener("unhandledrejection", (e) => push("promise", e.reason?.stack || e.reason));
  window.__mestreDevHook = { errors, since: Date.now() };
  return { installed: true, errors: 0 };
}

/** Mundo MAIN: frameworks, erros capturados, tempos de carregamento e armazenamento (sem valores). */
export function collectDevInfo() {
  const w = window;
  const fw = [];
  const has = (cond, name) => { try { if (cond()) fw.push(name); } catch { /* ignore */ } };
  has(() => w.React || w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size || document.querySelector("[data-reactroot]"), "React");
  has(() => w.__NEXT_DATA__ || document.getElementById("__next"), "Next.js");
  has(() => w.Vue || w.__VUE__ || document.querySelector("[data-v-app]"), "Vue");
  has(() => w.__NUXT__, "Nuxt");
  has(() => w.ng || document.querySelector("[ng-version]"), "Angular");
  has(() => document.querySelector("[class*='svelte-']"), "Svelte");
  has(() => w.jQuery, "jQuery");
  has(() => w.__remixContext, "Remix");
  has(() => document.querySelector("astro-island"), "Astro");
  has(() => w.wp || document.querySelector("link[href*='wp-content']"), "WordPress");
  has(() => w.Shopify, "Shopify");
  has(() => document.querySelector("[class*='tw-'], [class~='flex'][class*='px-']"), "Tailwind (provável)");
  has(() => w.gtag || w.dataLayer, "Google Analytics/Tag Manager");
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
  const timing = nav ? {
    ttfbMs: Math.round(nav.responseStart - nav.requestStart),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadMs: Math.round(nav.loadEventEnd),
    transferKB: Math.round((nav.transferSize || 0) / 1024),
    tipo: nav.type,
    ...paints,
  } : { observacao: "Navigation Timing indisponível." };
  const resources = performance.getEntriesByType("resource");
  const local = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local.push([k, (localStorage.getItem(k) || "").length]); } } catch { /* bloqueado */ }
  const session = [];
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); session.push([k, (sessionStorage.getItem(k) || "").length]); } } catch { /* bloqueado */ }
  return {
    url: location.href,
    frameworks: fw,
    erros: w.__mestreDevHook ? w.__mestreDevHook.errors.slice(-50) : [],
    errosDesde: w.__mestreDevHook ? w.__mestreDevHook.since : null,
    tempo: timing,
    recursos: resources.length,
    cookieString: (() => { try { return document.cookie; } catch { return ""; } })(),
    localStorage: local,
    sessionStorage: session,
    serviceWorker: Boolean(navigator.serviceWorker?.controller),
  };
}

/** Limpa os dados do site acessíveis pela página. Só roda depois da confirmação no painel. */
export async function clearSiteData() {
  const done = [];
  try { const n = localStorage.length; localStorage.clear(); done.push(`localStorage (${n})`); } catch { /* ignore */ }
  try { const n = sessionStorage.length; sessionStorage.clear(); done.push(`sessionStorage (${n})`); } catch { /* ignore */ }
  try {
    const names = document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean);
    const host = location.hostname;
    const parts = host.split(".");
    const domains = [""];
    for (let i = 0; i < parts.length - 1; i++) domains.push("; domain=." + parts.slice(i).join("."));
    for (const name of names) for (const d of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    done.push(`cookies visíveis (${names.length})`);
  } catch { /* ignore */ }
  try { if (self.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); done.push(`Cache Storage (${keys.length})`); } } catch { /* ignore */ }
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      dbs.forEach((db) => db.name && indexedDB.deleteDatabase(db.name));
      done.push(`IndexedDB (${dbs.length})`);
    }
  } catch { /* ignore */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    done.push(`service workers (${regs.length})`);
  } catch { /* ignore */ }
  return done;
}

/** Lê seleção, título e URL para copiar como nota. */
export function readNoteContext() {
  return { title: document.title, url: location.href, selection: String(window.getSelection() || "").trim().slice(0, 2000) };
}
