import assert from "node:assert/strict";
import test from "node:test";
import { canBootstrapSession, injectSessionBootstrap, isBrowserDocumentRequest, sameToken } from "./session-gate.js";

test("sameToken compara em tempo constante e rejeita vazio ou tamanho diferente", () => {
  assert.equal(sameToken("abc", "abc"), true);
  assert.equal(sameToken("abc", "abd"), false);
  assert.equal(sameToken("abc", "abcd"), false);
  assert.equal(sameToken("", "abc"), false);
});

test("só navegação de documento recebe o token no HTML", () => {
  const html = "<head><title>x</title></head>";
  assert.equal(isBrowserDocumentRequest({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }), true);
  assert.equal(isBrowserDocumentRequest({}), false);
  const injected = injectSessionBootstrap(html, "a".repeat(32));
  assert.match(injected, /mestre-session-token/);
  assert.match(injected, /session-client\.js/);
});

test("bootstrap exige Sec-Fetch e não aceita Origin sozinho", () => {
  const base = "http://127.0.0.1:7777";
  assert.equal(canBootstrapSession({ origin: base }, base), false);
  assert.equal(canBootstrapSession({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", origin: base }, base), true);
  assert.equal(canBootstrapSession({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin: base }, base), false);
  assert.equal(canBootstrapSession({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }, base), true);
});
