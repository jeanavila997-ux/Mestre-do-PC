/**
 * Ações das Ferramentas que usam chrome.* (popup, painel e service worker).
 */
import { applyDesignCss } from "./page-scripts.js";
import { buildThemeCss, canScriptUrl, isDefaultDesign, normalizeDesign, siteKey, TOOL_VIEWS } from "./tools-core.js";

const DESIGN_KEY = "designPorSite";

/** Abre o painel de Ferramentas numa janela pequena, mirando a aba atual. */
export async function openToolsWindow(view, tab, extra = {}) {
  if (!TOOL_VIEWS.includes(view)) throw new Error("Ferramenta desconhecida: " + view);
  const params = new URLSearchParams({ view, ...extra });
  if (tab?.id != null) params.set("tabId", String(tab.id));
  if (tab?.windowId != null) params.set("windowId", String(tab.windowId));
  const url = chrome.runtime.getURL("tools.html?" + params.toString());
  try {
    await chrome.windows.create({ url, type: "popup", width: 620, height: 760 });
  } catch {
    await chrome.tabs.create({ url });
  }
}

export async function getAllDesigns() {
  const data = await chrome.storage.local.get(DESIGN_KEY);
  return data[DESIGN_KEY] || {};
}

export async function getDesignFor(url) {
  const key = siteKey(url);
  if (!key) return null;
  const all = await getAllDesigns();
  return all[key] ? normalizeDesign(all[key]) : null;
}

export async function saveDesignFor(url, prefs) {
  const key = siteKey(url);
  if (!key) throw new Error("Esta página não aceita design (página interna do navegador).");
  const all = await getAllDesigns();
  if (isDefaultDesign(prefs)) delete all[key];
  else all[key] = normalizeDesign(prefs);
  await chrome.storage.local.set({ [DESIGN_KEY]: all });
}

export async function applyDesignToTab(tabId, prefs) {
  const css = prefs ? buildThemeCss(prefs) : "";
  await chrome.scripting.executeScript({ target: { tabId }, func: applyDesignCss, args: [css] });
}

/** Reaplica o design salvo do site, se houver (silencioso quando não há permissão). */
export async function applySavedDesign(tabId, url) {
  if (!canScriptUrl(url)) return false;
  const prefs = await getDesignFor(url);
  if (!prefs) return false;
  try {
    await applyDesignToTab(tabId, prefs);
    return true;
  } catch {
    return false;
  }
}

/** Permissão opcional para reaplicar o design sozinho em todo carregamento. */
export const AUTO_DESIGN_ORIGINS = ["https://*/*", "http://*/*"];

export async function hasAutoDesignPermission() {
  try {
    return await chrome.permissions.contains({ origins: AUTO_DESIGN_ORIGINS });
  } catch {
    return false;
  }
}
