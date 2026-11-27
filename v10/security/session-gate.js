import { randomBytes, timingSafeEqual } from "node:crypto";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function sameToken(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function header(headers, name) {
  if (!headers) return "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || "").trim().toLowerCase();
  return String(value || "").trim().toLowerCase();
}

/** Navegação de documento no navegador. curl e node fetch não mandam estes headers. */
export function isBrowserDocumentRequest(headers) {
  const dest = header(headers, "sec-fetch-dest");
  const mode = header(headers, "sec-fetch-mode");
  return dest === "document" || mode === "navigate";
}

/**
 * O bootstrap só entrega o token a um pedido que parece o navegador na própria origem.
 * Origin sozinho não basta: um cliente qualquer consegue forjar Origin, mas o
 * navegador é quem define Sec-Fetch-Site / Sec-Fetch-Mode.
 */
export function canBootstrapSession(headers, baseUrl) {
  const site = header(headers, "sec-fetch-site");
  const mode = header(headers, "sec-fetch-mode");
  const origin = String(headers?.origin || headers?.Origin || "").trim();
  if (site !== "same-origin" && site !== "none") return false;
  if (mode !== "navigate" && mode !== "cors" && mode !== "same-origin") return false;
  if (origin && origin !== baseUrl) return false;
  return true;
}

export function sessionHeadSnippet(token) {
  const safe = String(token || "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(safe)) {
    throw new Error("Token de sessão com formato inesperado.");
  }
  return `<meta name="mestre-session-token" content="${safe}">\n<script src="/session-client.js"></script>\n`;
}

export function injectSessionBootstrap(html, token) {
  const snippet = sessionHeadSnippet(token);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${snippet}`);
  }
  return snippet + html;
}
