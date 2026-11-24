/**
 * Chamadas ao launcher local do Mestre (127.0.0.1:7777) com o token da extensão.
 * Só operações cadastradas na allowlist (POST /run com id), nunca comando livre.
 */
import { getSettings, fetchLocal } from "./settings.js";

function headers(settings) {
  return {
    "Content-Type": "application/json",
    "X-Mestre-Client": "browser-extension",
    "X-Mestre-Extension-Token": settings.extensionToken,
  };
}

export async function runOperation(id, params) {
  const settings = await getSettings();
  if (!settings.extensionToken) throw new Error("Configure o token de extensão nas opções.");
  const res = await fetchLocal(settings.launcherUrl + "/run", {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify(params ? { id, params } : { id }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* corpo vazio */ }
  if (!res.ok || !data.accepted) throw new Error(data.output || `Erro ${res.status}`);
  return data;
}

export async function getRunStatus(jobId) {
  const settings = await getSettings();
  const res = await fetchLocal(settings.launcherUrl + "/run-status?id=" + encodeURIComponent(jobId), {
    headers: headers(settings),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/** Espera o job terminar (até timeoutMs) e devolve { state, output, success }. */
export async function waitForJob(jobId, { timeoutMs = 120000, intervalMs = 1500, onUpdate } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await getRunStatus(jobId);
    onUpdate?.(st);
    if (st.state && st.state !== "running") return st;
    if (Date.now() > deadline) return { ...st, state: "still_running" };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function launcherOnline() {
  try {
    const settings = await getSettings();
    const res = await fetchLocal(settings.launcherUrl + "/ping", {}, 2500);
    return res.ok;
  } catch {
    return false;
  }
}

/** Mesmo fluxo do "Enviar página para IA": exige consentimento e token. */
export async function askMestreAI(prompt) {
  const settings = await getSettings();
  if (settings.allowPageAnalysis !== true) throw new Error("Autorize o envio de titulo, URL e selecao para IA nas configuracoes.");
  if (!settings.extensionToken) throw new Error("Configure o token de extensão nas opções.");
  const res = await fetchLocal(settings.launcherUrl + "/ollama/chat", {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({
      model: "qwen2.5-coder:3b-instruct",
      messages: [{ role: "user", content: prompt }],
      stream: false,
      keep_alive: "5m",
    }),
  }, 90000);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return data.message?.content || "Resposta recebida, sem texto.";
}
