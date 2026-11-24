const EMBEDDING_PATTERN = /(?:^|[-_:/])(?:nomic-embed(?:-text)?|bge(?:-|\b)|gte(?:-|\b)|embedding(?:-|\b)|embed(?:-|\b))/i;

export function isEmbeddingModel(name) {
  return EMBEDDING_PATTERN.test(String(name || ""));
}

export function isChatModel(name) {
  return Boolean(String(name || "").trim()) && !isEmbeddingModel(name);
}

export async function getLiveModels(options = {}) {
  const baseUrl = String(options.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password) {
    throw new Error("O catálogo ao vivo aceita somente Ollama local em http://127.0.0.1.");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(options.timeoutMs || 10000) });
  if (!response.ok) throw new Error(`Ollama retornou HTTP ${response.status} ao listar modelos.`);
  const payload = await response.json();
  if (!Array.isArray(payload.models)) throw new Error("Ollama retornou um catálogo inválido.");
  return payload.models.map((entry) => {
    const name = String(entry.name || entry.model || "").trim();
    return {
      name,
      capability: isEmbeddingModel(name) ? "embedding" : "chat",
      size: Number.isFinite(entry.size) ? entry.size : null,
      modifiedAt: entry.modified_at || null,
      parameterSize: entry.details?.parameter_size || null,
    };
  }).filter((entry) => entry.name).sort((a, b) => a.name.localeCompare(b.name, "en"));
}
