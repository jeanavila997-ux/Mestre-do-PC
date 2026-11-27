/**
 * Store local da memória de aprendizagem, biblioteca e personas.
 * SQLite em data/chat-user/ (gitignored). Embeddings via Ollama em 127.0.0.1.
 */

import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  BUILTIN_PERSONAS,
  DEFAULT_EMBED_MODEL,
  DEDUPE_COSINE,
  DEDUPE_JACCARD,
  EMBED_BATCH,
  LIMITS,
  buildMemoryContext,
  buildProfileContext,
  cosineSimilarity,
  formatDecision,
  isLocalChatModel,
  jaccardScore,
  keywordScore,
  loopbackOllamaBase,
  mergeRedaction,
  normalizeMemoryType,
  normalizeVector,
  parseLearnJson,
  protectText,
  sanitizeUntrusted,
} from "./user-library-pure.js";

export class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const LEARN_SYSTEM = `Você extrai memórias estáveis de uma conversa. Responda somente JSON válido, sem markdown:
{"memorias":[{"type":"fato|preferência|decisão|lição","text":"..."}]}
No máximo 3 itens. Se não houver nada durável, {"memorias":[]}.
Não invente. Não copie senhas, tokens, chaves ou segredos.
Decisão: o que foi decidido e por quê, em uma frase. text com no máximo 240 caracteres.`;

function uuid() {
  return randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function ollamaEmbed(texts, { model, baseUrl }) {
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data.embeddings) ? data.embeddings : null;
}

async function ollamaChat({ model, prompt, baseUrl }) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature: 0.1, num_predict: 320 },
      messages: [
        { role: "system", content: LEARN_SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new LibraryError("Ollama não respondeu à extração.", 502);
  const data = await response.json();
  return String(data?.message?.content || "");
}

function emptyProfile(updatedAt = "") {
  return {
    name: "",
    addressAs: "",
    preferences: "",
    projects: "",
    notes: "",
    updatedAt,
  };
}

export function createUserLibrary({
  dir,
  embedTexts = ollamaEmbed,
  completeChat = ollamaChat,
  ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434",
} = {}) {
  if (!dir) throw new LibraryError("Diretório da biblioteca não informado.", 500);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "chat-user.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('fato','preferência','decisão','lição')),
      text TEXT NOT NULL,
      conversation_id TEXT,
      model TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      conversation_id TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT '',
      address_as TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '',
      projects TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      builtin_key TEXT UNIQUE,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      suggested_profile TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_persona (
      conversation_id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      role TEXT NOT NULL,
      model TEXT,
      memory_ids_json TEXT NOT NULL DEFAULT '[]',
      persona_id TEXT,
      persona_name TEXT,
      created_at TEXT NOT NULL
    );
  `);

  function setting(key, fallback = "") {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : fallback;
  }

  function putSetting(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  function seed() {
    const stamp = nowIso();
    for (const persona of BUILTIN_PERSONAS) {
      const exists = db.prepare("SELECT id FROM personas WHERE builtin_key = ?").get(persona.key);
      if (exists) continue;
      db.prepare(`
        INSERT INTO personas (id, builtin_key, name, body, suggested_profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), persona.key, persona.name, persona.body, persona.suggestedProfile || "", stamp, stamp);
    }
    if (!setting("default_persona_id")) {
      const general = db.prepare("SELECT id FROM personas WHERE builtin_key = ?").get("assistente-geral");
      if (general) putSetting("default_persona_id", general.id);
    }
    if (!setting("auto_learn")) putSetting("auto_learn", "1");
    if (!setting("embedding_model")) putSetting("embedding_model", DEFAULT_EMBED_MODEL);
    if (!setting("top_k")) putSetting("top_k", String(LIMITS.topKDefault));
    if (!db.prepare("SELECT id FROM profile WHERE id = 1").get()) {
      db.prepare(`
        INSERT INTO profile (id, name, address_as, preferences, projects, notes, updated_at)
        VALUES (1, '', '', '', '', '', ?)
      `).run(stamp);
    }
  }
  seed();

  function baseUrl() {
    return loopbackOllamaBase(ollamaUrl);
  }

  function readSettings() {
    const topK = Number(setting("top_k", String(LIMITS.topKDefault)));
    return {
      autoLearn: setting("auto_learn", "1") !== "0",
      embeddingModel: setting("embedding_model", DEFAULT_EMBED_MODEL) || DEFAULT_EMBED_MODEL,
      topK: Number.isFinite(topK) ? Math.min(LIMITS.topKMax, Math.max(1, topK)) : LIMITS.topKDefault,
      defaultPersonaId: setting("default_persona_id", ""),
    };
  }

  async function embed(texts, model) {
    const clipped = texts.map((text) => sanitizeUntrusted(text, LIMITS.embedChars));
    const out = [];
    try {
      for (let i = 0; i < clipped.length; i += EMBED_BATCH) {
        const chunk = clipped.slice(i, i + EMBED_BATCH);
        const vectors = await embedTexts(chunk, { model, baseUrl: baseUrl() });
        if (!Array.isArray(vectors) || vectors.length !== chunk.length) return null;
        for (const vector of vectors) out.push(normalizeVector(vector));
      }
    } catch {
      return null;
    }
    return out;
  }

  function mapMemory(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      text: row.text,
      conversationId: row.conversation_id || "",
      model: row.model || "",
      embedding: parseJson(row.embedding_json, null),
      embeddingModel: row.embedding_model || "",
      pinned: !!row.pinned,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function publicMemory(memory) {
    if (!memory) return null;
    return {
      id: memory.id,
      type: memory.type,
      text: memory.text,
      conversationId: memory.conversationId,
      model: memory.model,
      embeddingModel: memory.embeddingModel,
      hasEmbedding: Array.isArray(memory.embedding),
      pinned: memory.pinned,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    };
  }

  function mapPrompt(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      favorite: !!row.favorite,
      embedding: parseJson(row.embedding_json, null),
      embeddingModel: row.embedding_model || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function publicPrompt(prompt) {
    if (!prompt) return null;
    const { embedding, ...rest } = prompt;
    return { ...rest, hasEmbedding: Array.isArray(embedding) };
  }

  function mapSnippet(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      language: row.language || "",
      code: row.code,
      tags: parseJson(row.tags_json, []),
      conversationId: row.conversation_id || "",
      embedding: parseJson(row.embedding_json, null),
      embeddingModel: row.embedding_model || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function publicSnippet(snippet) {
    if (!snippet) return null;
    const { embedding, ...rest } = snippet;
    return { ...rest, hasEmbedding: Array.isArray(embedding) };
  }

  function mapPersona(row) {
    if (!row) return null;
    return {
      id: row.id,
      builtinKey: row.builtin_key || "",
      name: row.name,
      body: row.body,
      suggestedProfile: row.suggested_profile || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function requireId(id) {
    const value = String(id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new LibraryError("Identificador inválido.", 400);
    }
    return value;
  }

  function optionalConversation(id) {
    if (!id) return "";
    return requireId(id);
  }

  function allMemories() {
    return db.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").all(LIMITS.memories).map(mapMemory);
  }

  function scoreOf(query, queryVec, item, text) {
    if (queryVec && item.embedding && item.embedding.length === queryVec.length && item.embeddingModel === readSettings().embeddingModel) {
      return cosineSimilarity(queryVec, item.embedding);
    }
    return keywordScore(query, text);
  }

  const embeddingUpdates = {
    memories: db.prepare("UPDATE memories SET embedding_json = ?, embedding_model = ? WHERE id = ?"),
    prompts: db.prepare("UPDATE prompts SET embedding_json = ?, embedding_model = ? WHERE id = ?"),
    snippets: db.prepare("UPDATE snippets SET embedding_json = ?, embedding_model = ? WHERE id = ?"),
  };

  async function ensureEmbeddings(table, items, textOf) {
    const update = embeddingUpdates[table];
    if (!update) throw new LibraryError("Tabela de embedding inválida.", 500);
    const model = readSettings().embeddingModel;
    const stale = items.filter((item) => !item.embedding || item.embeddingModel !== model).slice(0, EMBED_BATCH);
    if (!stale.length) return;
    const vectors = await embed(stale.map(textOf), model);
    if (!vectors) return;
    for (let i = 0; i < stale.length; i += 1) {
      if (!vectors[i]) continue;
      stale[i].embedding = vectors[i];
      stale[i].embeddingModel = model;
      update.run(JSON.stringify(vectors[i]), model, stale[i].id);
    }
  }

  async function rank(table, query, items, textOf, limit) {
    await ensureEmbeddings(table, items, textOf);
    const model = readSettings().embeddingModel;
    const queryVec = query ? (await embed([query], model))?.[0] || null : null;
    return items
      .map((item) => ({ item, score: query ? scoreOf(query, queryVec, item, textOf(item)) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function similarMemory(text, vector, model) {
    for (const existing of allMemories()) {
      if (vector && existing.embedding && existing.embeddingModel === model && existing.embedding.length === vector.length) {
        if (cosineSimilarity(vector, existing.embedding) >= DEDUPE_COSINE) return existing;
      } else if (jaccardScore(text, existing.text) >= DEDUPE_JACCARD) {
        return existing;
      }
    }
    return null;
  }

  async function createMemory(input, { embedNow = true, skipDedupe = false } = {}) {
    const type = normalizeMemoryType(input?.type);
    if (!type) throw new LibraryError("Tipo inválido. Use fato, preferência, decisão ou lição.", 400);
    const count = db.prepare("SELECT COUNT(*) AS n FROM memories").get().n;
    if (count >= LIMITS.memories) throw new LibraryError("Limite de memórias atingido.", 400);
    const protectedText = protectText(input?.text, LIMITS.memoryText);
    if (!protectedText.text) throw new LibraryError("Texto da memória vazio.", 400);
    if (String(input?.text || "").replace(/\s+/g, " ").trim().length > LIMITS.memoryText) {
      throw new LibraryError(`Texto excede ${LIMITS.memoryText} caracteres.`, 400);
    }
    const modelName = readSettings().embeddingModel;
    let vector = null;
    if (embedNow) {
      vector = (await embed([protectedText.text], modelName))?.[0] || null;
    } else if (input?.embedding && input?.embeddingModel === modelName) {
      vector = normalizeVector(input.embedding);
    }
    if (!skipDedupe) {
      const duplicate = similarMemory(protectedText.text, vector, modelName);
      if (duplicate) {
        return { memory: publicMemory(duplicate), duplicate: true, duplicateOf: duplicate.id, redaction: protectedText.redaction };
      }
    }
    const stamp = nowIso();
    const id = uuid();
    const conversationId = optionalConversation(input?.conversationId);
    db.prepare(`
      INSERT INTO memories (id, type, text, conversation_id, model, embedding_json, embedding_model, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      type,
      protectedText.text,
      conversationId,
      sanitizeUntrusted(input?.model, 128),
      vector ? JSON.stringify(vector) : null,
      vector ? modelName : "",
      input?.pinned ? 1 : 0,
      stamp,
      stamp,
    );
    return { memory: publicMemory(mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id))), duplicate: false, redaction: protectedText.redaction };
  }

  async function updateMemory(id, patch) {
    const current = mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(requireId(id)));
    if (!current) throw new LibraryError("Memória não encontrada.", 404);
    const type = patch.type != null ? normalizeMemoryType(patch.type) : current.type;
    if (!type) throw new LibraryError("Tipo inválido.", 400);
    let text = current.text;
    let redaction = { redacted: false, kinds: [] };
    let vector = current.embedding;
    let embeddingModel = current.embeddingModel;
    if (patch.text != null) {
      if (String(patch.text).length > LIMITS.memoryText) throw new LibraryError(`Texto excede ${LIMITS.memoryText} caracteres.`, 400);
      const protectedText = protectText(patch.text, LIMITS.memoryText);
      if (!protectedText.text) throw new LibraryError("Texto da memória vazio.", 400);
      text = protectedText.text;
      redaction = protectedText.redaction;
      const modelName = readSettings().embeddingModel;
      vector = (await embed([text], modelName))?.[0] || null;
      embeddingModel = vector ? modelName : "";
    }
    const pinned = patch.pinned != null ? (patch.pinned ? 1 : 0) : (current.pinned ? 1 : 0);
    const stamp = nowIso();
    db.prepare(`
      UPDATE memories
      SET type = ?, text = ?, embedding_json = ?, embedding_model = ?, pinned = ?, updated_at = ?
      WHERE id = ?
    `).run(type, text, vector ? JSON.stringify(vector) : null, embeddingModel, pinned, stamp, current.id);
    return { memory: publicMemory(mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(current.id))), redaction };
  }

  function listMemoriesSync() {
    return allMemories().map(publicMemory);
  }

  async function searchMemories(query, type, limit = 50) {
    let items = allMemories();
    if (type) {
      const normalized = normalizeMemoryType(type);
      if (!normalized) throw new LibraryError("Tipo inválido.", 400);
      items = items.filter((item) => item.type === normalized);
    }
    if (!query) return items.slice(0, limit).map(publicMemory);
    const ranked = await rank("memories", query, items, (item) => item.text, limit);
    return ranked.map((entry) => ({ ...publicMemory(entry.item), score: Number(entry.score.toFixed(4)) }));
  }

  async function recall(query, k) {
    const settings = readSettings();
    const limit = Math.min(settings.topK, LIMITS.topKMax, Math.max(1, Number(k) || settings.topK));
    const items = allMemories();
    const pinned = items.filter((item) => item.pinned).slice(0, 3);
    const ranked = query ? await rank("memories", query, items.filter((item) => !item.pinned), (item) => item.text, limit) : [];
    const picked = [...pinned];
    for (const entry of ranked) {
      if (picked.length >= limit && pinned.length === 0) break;
      if (picked.length >= Math.max(limit, pinned.length)) break;
      if (entry.score <= 0) continue;
      picked.push(entry.item);
    }
    const unique = [];
    for (const item of picked) {
      if (!unique.some((found) => found.id === item.id)) unique.push(item);
    }
    const memories = unique.slice(0, 6);
    return { memories: memories.map(publicMemory), context: buildMemoryContext(memories) };
  }

  async function learnFromTurn({ userText, assistantText, model, conversationId }) {
    const local = isLocalChatModel(model) ? String(model).trim() : "";
    if (!local) return { skipped: true, reason: "modelo não local", created: [], duplicates: [] };
    const user = sanitizeUntrusted(userText, LIMITS.learnChars);
    const assistant = sanitizeUntrusted(assistantText, LIMITS.learnChars);
    if (!user && !assistant) return { skipped: true, reason: "turno vazio", created: [], duplicates: [] };
    let raw = "";
    try {
      raw = await completeChat({
        model: local,
        baseUrl: baseUrl(),
        prompt: `Usuário:\n${user}\n\nAssistente:\n${assistant}`,
      });
    } catch {
      return { skipped: true, reason: "extração indisponível", created: [], duplicates: [] };
    }
    const created = [];
    const duplicates = [];
    let redaction = { redacted: false, kinds: [] };
    for (const item of parseLearnJson(raw)) {
      const saved = await createMemory({ ...item, model: local, conversationId });
      mergeRedaction(redaction, saved.redaction);
      if (saved.duplicate) duplicates.push(saved.duplicateOf);
      else created.push(saved.memory);
    }
    return { skipped: false, created, duplicates, redaction };
  }

  function getPersona(id) {
    if (!id) return null;
    return mapPersona(db.prepare("SELECT * FROM personas WHERE id = ?").get(id));
  }

  function listPersonas() {
    return db.prepare("SELECT * FROM personas ORDER BY name COLLATE NOCASE").all().map(mapPersona);
  }

  function resolvePersona(conversationId) {
    const settings = readSettings();
    const overrideId = conversationId
      ? db.prepare("SELECT persona_id FROM conversation_persona WHERE conversation_id = ?").get(conversationId)?.persona_id
      : "";
    const override = getPersona(overrideId);
    if (override) return { persona: override, scope: "conversation" };
    const fallback = getPersona(settings.defaultPersonaId) || listPersonas()[0] || null;
    return { persona: fallback, scope: "default" };
  }

  function knownMemoryIds(ids) {
    const clean = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) continue;
      if (db.prepare("SELECT id FROM memories WHERE id = ?").get(id)) clean.push(id);
      if (clean.length >= 8) break;
    }
    return clean;
  }

  function recordAudit({ conversationId, role, model, memoryIds, persona }) {
    db.prepare(`
      INSERT INTO message_audit (id, conversation_id, role, model, memory_ids_json, persona_id, persona_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      conversationId || "",
      role,
      sanitizeUntrusted(model, 128),
      JSON.stringify(memoryIds || []),
      persona?.id || "",
      persona?.name || "",
      nowIso(),
    );
  }

  function listAudit(conversationId, limit = 30) {
    const rows = conversationId
      ? db.prepare("SELECT * FROM message_audit WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(optionalConversation(conversationId), Math.min(limit, LIMITS.audit))
      : db.prepare("SELECT * FROM message_audit ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, LIMITS.audit));
    return rows.map((row) => {
      const ids = parseJson(row.memory_ids_json, []);
      const memories = ids.map((id) => publicMemory(mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id)))).filter(Boolean);
      return {
        id: row.id,
        conversationId: row.conversation_id || "",
        role: row.role,
        model: row.model || "",
        personaId: row.persona_id || "",
        personaName: row.persona_name || "",
        memoryIds: ids,
        memories,
        createdAt: row.created_at,
      };
    });
  }

  function readProfile() {
    const row = db.prepare("SELECT * FROM profile WHERE id = 1").get();
    if (!row) return emptyProfile();
    return {
      name: row.name,
      addressAs: row.address_as,
      preferences: row.preferences,
      projects: row.projects,
      notes: row.notes,
      updatedAt: row.updated_at,
    };
  }

  function cleanTags(tags) {
    const out = [];
    for (const tag of Array.isArray(tags) ? tags : []) {
      const text = sanitizeUntrusted(tag, LIMITS.snippetTag).toLowerCase();
      if (!text || out.includes(text)) continue;
      out.push(text);
      if (out.length >= LIMITS.snippetTags) break;
    }
    return out;
  }

  function cleanProfileSuggestion(value) {
    const text = sanitizeUntrusted(value, 40);
    if (!text) return "";
    if (!/^[a-z0-9_-]{1,40}$/i.test(text)) throw new LibraryError("Perfil sugerido inválido.", 400);
    return text;
  }

  function cleanLanguage(language) {
    const text = sanitizeUntrusted(language, LIMITS.snippetLanguage).toLowerCase();
    if (!text) return "";
    if (!/^[a-z0-9_+#.-]+$/.test(text)) throw new LibraryError("Linguagem inválida.", 400);
    return text;
  }

  function requireTitle(title, max) {
    const text = sanitizeUntrusted(title, max);
    if (!text) throw new LibraryError("Título vazio.", 400);
    if (String(title || "").trim().length > max) throw new LibraryError(`Título excede ${max} caracteres.`, 400);
    return text;
  }

  const api = {
    readSettings,
    updateSettings(patch) {
      if (patch.autoLearn != null) putSetting("auto_learn", patch.autoLearn ? "1" : "0");
      if (patch.embeddingModel != null) {
        const model = String(patch.embeddingModel || "").trim();
        if (!/^[a-zA-Z0-9_.:@+-]{1,80}$/.test(model) || /[:/]\/\//.test(model)) {
          throw new LibraryError("Modelo de embedding inválido.", 400);
        }
        putSetting("embedding_model", model);
      }
      if (patch.topK != null) {
        const topK = Number(patch.topK);
        if (!Number.isInteger(topK) || topK < 1 || topK > LIMITS.topKMax) {
          throw new LibraryError(`topK deve ficar entre 1 e ${LIMITS.topKMax}.`, 400);
        }
        putSetting("top_k", String(topK));
      }
      return readSettings();
    },
    listMemories: listMemoriesSync,
    searchMemories,
    createMemory,
    updateMemory,
    deleteMemory(id) {
      const result = db.prepare("DELETE FROM memories WHERE id = ?").run(requireId(id));
      if (!result.changes) throw new LibraryError("Memória não encontrada.", 404);
      return { ok: true };
    },
    async togglePin(id) {
      const current = mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(requireId(id)));
      if (!current) throw new LibraryError("Memória não encontrada.", 404);
      return updateMemory(current.id, { pinned: !current.pinned });
    },
    async createDecision(input) {
      const decision = formatDecision({ text: input?.text, why: input?.why, date: input?.date });
      return createMemory({
        type: "decisão",
        text: decision,
        conversationId: input?.conversationId,
        model: input?.model,
      });
    },
    recall,
    learnFromTurn,
    async prepare({ query, conversationId, includePersonal = true, topK }) {
      const convo = optionalConversation(conversationId);
      const resolved = resolvePersona(convo);
      let memories = [];
      let memoryBlock = "";
      let profileBlock = "";
      if (includePersonal) {
        profileBlock = buildProfileContext(readProfile());
        if (query) {
          const recalled = await recall(query, topK);
          memories = recalled.memories;
          memoryBlock = recalled.context;
        }
      }
      return {
        persona: resolved.persona,
        scope: resolved.scope,
        systemPrompt: resolved.persona?.body || "",
        profileBlock,
        memoryBlock,
        memories,
      };
    },
    async afterTurn({ userText, assistantText, model, conversationId, memoryIds, personaId, learn }) {
      const convo = optionalConversation(conversationId);
      const persona = getPersona(personaId) || resolvePersona(convo).persona;
      const ids = knownMemoryIds(memoryIds);
      recordAudit({ conversationId: convo, role: "user", model: "", memoryIds: [], persona });
      recordAudit({ conversationId: convo, role: "assistant", model, memoryIds: ids, persona });
      const settings = readSettings();
      if (!learn || !settings.autoLearn) {
        return { ok: true, learning: { skipped: true, reason: settings.autoLearn ? "sob demanda" : "aprendizado automático desligado" } };
      }
      const learning = await learnFromTurn({ userText, assistantText, model, conversationId: convo });
      return { ok: true, learning };
    },
    listAudit,
    listPrompts() {
      return db.prepare("SELECT * FROM prompts ORDER BY favorite DESC, updated_at DESC").all().map((row) => publicPrompt(mapPrompt(row)));
    },
    async searchPrompts(query, limit = 50) {
      const items = db.prepare("SELECT * FROM prompts ORDER BY favorite DESC, updated_at DESC").all().map(mapPrompt);
      if (!query) return items.slice(0, limit).map(publicPrompt);
      const ranked = await rank("prompts", query, items, (item) => `${item.title}\n${item.body}`, limit);
      return ranked.map((entry) => ({ ...publicPrompt(entry.item), score: Number(entry.score.toFixed(4)) }));
    },
    async createPrompt(input) {
      if (db.prepare("SELECT COUNT(*) AS n FROM prompts").get().n >= LIMITS.prompts) {
        throw new LibraryError("Limite de prompts atingido.", 400);
      }
      const title = requireTitle(input?.title, LIMITS.promptTitle);
      if (String(input?.body || "").length > LIMITS.promptBody) throw new LibraryError(`Prompt excede ${LIMITS.promptBody} caracteres.`, 400);
      const body = protectText(input?.body, LIMITS.promptBody);
      if (!body.text) throw new LibraryError("Prompt vazio.", 400);
      const modelName = readSettings().embeddingModel;
      const vector = (await embed([`${title}\n${body.text}`], modelName))?.[0] || null;
      const stamp = nowIso();
      const id = uuid();
      db.prepare(`
        INSERT INTO prompts (id, title, body, favorite, embedding_json, embedding_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, body.text, input?.favorite ? 1 : 0, vector ? JSON.stringify(vector) : null, vector ? modelName : "", stamp, stamp);
      return { prompt: publicPrompt(mapPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(id))), redaction: body.redaction };
    },
    async updatePrompt(id, patch) {
      const current = mapPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(requireId(id)));
      if (!current) throw new LibraryError("Prompt não encontrado.", 404);
      const title = patch.title != null ? requireTitle(patch.title, LIMITS.promptTitle) : current.title;
      let body = current.body;
      let redaction = { redacted: false, kinds: [] };
      if (patch.body != null) {
        if (String(patch.body).length > LIMITS.promptBody) throw new LibraryError(`Prompt excede ${LIMITS.promptBody} caracteres.`, 400);
        const protectedBody = protectText(patch.body, LIMITS.promptBody);
        if (!protectedBody.text) throw new LibraryError("Prompt vazio.", 400);
        body = protectedBody.text;
        redaction = protectedBody.redaction;
      }
      const favorite = patch.favorite != null ? (patch.favorite ? 1 : 0) : (current.favorite ? 1 : 0);
      const modelName = readSettings().embeddingModel;
      const vector = (await embed([`${title}\n${body}`], modelName))?.[0] || null;
      const stamp = nowIso();
      db.prepare(`
        UPDATE prompts SET title = ?, body = ?, favorite = ?, embedding_json = ?, embedding_model = ?, updated_at = ? WHERE id = ?
      `).run(title, body, favorite, vector ? JSON.stringify(vector) : null, vector ? modelName : "", stamp, current.id);
      return { prompt: publicPrompt(mapPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(current.id))), redaction };
    },
    deletePrompt(id) {
      const result = db.prepare("DELETE FROM prompts WHERE id = ?").run(requireId(id));
      if (!result.changes) throw new LibraryError("Prompt não encontrado.", 404);
      return { ok: true };
    },
    async toggleFavorite(id) {
      const current = mapPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(requireId(id)));
      if (!current) throw new LibraryError("Prompt não encontrado.", 404);
      return api.updatePrompt(current.id, { favorite: !current.favorite });
    },
    listSnippets() {
      return db.prepare("SELECT * FROM snippets ORDER BY updated_at DESC").all().map((row) => publicSnippet(mapSnippet(row)));
    },
    async searchSnippets(query, language, limit = 50) {
      let items = db.prepare("SELECT * FROM snippets ORDER BY updated_at DESC").all().map(mapSnippet);
      if (language) {
        const lang = cleanLanguage(language);
        items = items.filter((item) => item.language === lang);
      }
      if (!query) return items.slice(0, limit).map(publicSnippet);
      const ranked = await rank("snippets", query, items, (item) => `${item.title}\n${item.language}\n${(item.tags || []).join(" ")}\n${item.code}`, limit);
      return ranked.map((entry) => ({ ...publicSnippet(entry.item), score: Number(entry.score.toFixed(4)) }));
    },
    async createSnippet(input) {
      if (db.prepare("SELECT COUNT(*) AS n FROM snippets").get().n >= LIMITS.snippets) {
        throw new LibraryError("Limite de códigos atingido.", 400);
      }
      const title = requireTitle(input?.title || "Código sem título", LIMITS.snippetTitle);
      if (String(input?.code || "").length > LIMITS.snippetCode) throw new LibraryError(`Código excede ${LIMITS.snippetCode} caracteres.`, 400);
      const code = protectText(input?.code, LIMITS.snippetCode);
      if (!code.text) throw new LibraryError("Código vazio.", 400);
      const language = cleanLanguage(input?.language);
      const tags = cleanTags(input?.tags);
      const modelName = readSettings().embeddingModel;
      const vector = (await embed([`${title}\n${code.text}`], modelName))?.[0] || null;
      const stamp = nowIso();
      const id = uuid();
      db.prepare(`
        INSERT INTO snippets (id, title, language, code, tags_json, conversation_id, embedding_json, embedding_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        title,
        language,
        code.text,
        JSON.stringify(tags),
        optionalConversation(input?.conversationId),
        vector ? JSON.stringify(vector) : null,
        vector ? modelName : "",
        stamp,
        stamp,
      );
      return { snippet: publicSnippet(mapSnippet(db.prepare("SELECT * FROM snippets WHERE id = ?").get(id))), redaction: code.redaction };
    },
    async updateSnippet(id, patch) {
      const current = mapSnippet(db.prepare("SELECT * FROM snippets WHERE id = ?").get(requireId(id)));
      if (!current) throw new LibraryError("Código não encontrado.", 404);
      const title = patch.title != null ? requireTitle(patch.title, LIMITS.snippetTitle) : current.title;
      const language = patch.language != null ? cleanLanguage(patch.language) : current.language;
      const tags = patch.tags != null ? cleanTags(patch.tags) : current.tags;
      let code = current.code;
      let redaction = { redacted: false, kinds: [] };
      if (patch.code != null) {
        if (String(patch.code).length > LIMITS.snippetCode) throw new LibraryError(`Código excede ${LIMITS.snippetCode} caracteres.`, 400);
        const protectedCode = protectText(patch.code, LIMITS.snippetCode);
        if (!protectedCode.text) throw new LibraryError("Código vazio.", 400);
        code = protectedCode.text;
        redaction = protectedCode.redaction;
      }
      const modelName = readSettings().embeddingModel;
      const vector = (await embed([`${title}\n${code}`], modelName))?.[0] || null;
      const stamp = nowIso();
      db.prepare(`
        UPDATE snippets
        SET title = ?, language = ?, code = ?, tags_json = ?, embedding_json = ?, embedding_model = ?, updated_at = ?
        WHERE id = ?
      `).run(title, language, code, JSON.stringify(tags), vector ? JSON.stringify(vector) : null, vector ? modelName : "", stamp, current.id);
      return { snippet: publicSnippet(mapSnippet(db.prepare("SELECT * FROM snippets WHERE id = ?").get(current.id))), redaction };
    },
    deleteSnippet(id) {
      const result = db.prepare("DELETE FROM snippets WHERE id = ?").run(requireId(id));
      if (!result.changes) throw new LibraryError("Código não encontrado.", 404);
      return { ok: true };
    },
    getProfile() {
      return readProfile();
    },
    updateProfile(patch) {
      const current = readProfile();
      const fields = ["name", "addressAs", "preferences", "projects", "notes"];
      const next = { ...current };
      let redaction = { redacted: false, kinds: [] };
      for (const field of fields) {
        if (patch[field] == null) continue;
        if (String(patch[field]).length > LIMITS.profileField) {
          throw new LibraryError(`Campo excede ${LIMITS.profileField} caracteres.`, 400);
        }
        const protectedField = protectText(patch[field], LIMITS.profileField);
        next[field] = protectedField.text;
        mergeRedaction(redaction, protectedField.redaction);
      }
      const stamp = nowIso();
      db.prepare(`
        UPDATE profile
        SET name = ?, address_as = ?, preferences = ?, projects = ?, notes = ?, updated_at = ?
        WHERE id = 1
      `).run(next.name, next.addressAs, next.preferences, next.projects, next.notes, stamp);
      return { profile: readProfile(), redaction };
    },
    listPersonas,
    createPersona(input) {
      if (db.prepare("SELECT COUNT(*) AS n FROM personas").get().n >= LIMITS.personas) {
        throw new LibraryError("Limite de personas atingido.", 400);
      }
      const name = requireTitle(input?.name, LIMITS.personaName);
      if (String(input?.body || "").length > LIMITS.personaBody) throw new LibraryError(`Persona excede ${LIMITS.personaBody} caracteres.`, 400);
      const body = protectText(input?.body, LIMITS.personaBody);
      if (!body.text) throw new LibraryError("Persona vazia.", 400);
      const suggested = cleanProfileSuggestion(input?.suggestedProfile);
      const stamp = nowIso();
      const id = uuid();
      db.prepare(`
        INSERT INTO personas (id, builtin_key, name, body, suggested_profile, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
      `).run(id, name, body.text, suggested, stamp, stamp);
      return { persona: getPersona(id), redaction: body.redaction };
    },
    updatePersona(id, patch) {
      const current = getPersona(requireId(id));
      if (!current) throw new LibraryError("Persona não encontrada.", 404);
      const name = patch.name != null ? requireTitle(patch.name, LIMITS.personaName) : current.name;
      let body = current.body;
      let redaction = { redacted: false, kinds: [] };
      if (patch.body != null) {
        if (String(patch.body).length > LIMITS.personaBody) throw new LibraryError(`Persona excede ${LIMITS.personaBody} caracteres.`, 400);
        const protectedBody = protectText(patch.body, LIMITS.personaBody);
        if (!protectedBody.text) throw new LibraryError("Persona vazia.", 400);
        body = protectedBody.text;
        redaction = protectedBody.redaction;
      }
      const suggested = patch.suggestedProfile != null ? cleanProfileSuggestion(patch.suggestedProfile) : current.suggestedProfile;
      db.prepare("UPDATE personas SET name = ?, body = ?, suggested_profile = ?, updated_at = ? WHERE id = ?")
        .run(name, body, suggested, nowIso(), current.id);
      return { persona: getPersona(current.id), redaction };
    },
    deletePersona(id) {
      const current = getPersona(requireId(id));
      if (!current) throw new LibraryError("Persona não encontrada.", 404);
      db.prepare("DELETE FROM personas WHERE id = ?").run(current.id);
      db.prepare("DELETE FROM conversation_persona WHERE persona_id = ?").run(current.id);
      if (readSettings().defaultPersonaId === current.id) putSetting("default_persona_id", "");
      return { ok: true };
    },
    duplicatePersona(id) {
      const current = getPersona(requireId(id));
      if (!current) throw new LibraryError("Persona não encontrada.", 404);
      const name = `Cópia de ${current.name}`.slice(0, LIMITS.personaName);
      return api.createPersona({ name, body: current.body, suggestedProfile: current.suggestedProfile });
    },
    restorePersonas() {
      const stamp = nowIso();
      for (const persona of BUILTIN_PERSONAS) {
        const existing = db.prepare("SELECT id FROM personas WHERE builtin_key = ?").get(persona.key);
        if (existing) {
          db.prepare(`
            UPDATE personas SET name = ?, body = ?, suggested_profile = ?, updated_at = ? WHERE id = ?
          `).run(persona.name, persona.body, persona.suggestedProfile || "", stamp, existing.id);
        } else {
          db.prepare(`
            INSERT INTO personas (id, builtin_key, name, body, suggested_profile, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(uuid(), persona.key, persona.name, persona.body, persona.suggestedProfile || "", stamp, stamp);
        }
      }
      if (!getPersona(readSettings().defaultPersonaId)) {
        const general = db.prepare("SELECT id FROM personas WHERE builtin_key = ?").get("assistente-geral");
        if (general) putSetting("default_persona_id", general.id);
      }
      return { personas: listPersonas() };
    },
    getActivePersona(conversationId) {
      const resolved = resolvePersona(optionalConversation(conversationId));
      return {
        persona: resolved.persona,
        scope: conversationId ? resolved.scope : "default",
        defaultPersonaId: readSettings().defaultPersonaId,
      };
    },
    setActivePersona({ personaId, scope, conversationId }) {
      const persona = getPersona(requireId(personaId));
      if (!persona) throw new LibraryError("Persona não encontrada.", 404);
      if (scope === "default") {
        putSetting("default_persona_id", persona.id);
        return { persona, scope: "default", defaultPersonaId: persona.id };
      }
      if (scope === "conversation") {
        const convo = optionalConversation(conversationId);
        if (!convo) throw new LibraryError("Informe a conversa.", 400);
        db.prepare(`
          INSERT INTO conversation_persona (conversation_id, persona_id) VALUES (?, ?)
          ON CONFLICT(conversation_id) DO UPDATE SET persona_id = excluded.persona_id
        `).run(convo, persona.id);
        return { persona, scope: "conversation", defaultPersonaId: readSettings().defaultPersonaId };
      }
      if (scope === "clear-conversation") {
        const convo = optionalConversation(conversationId);
        if (convo) db.prepare("DELETE FROM conversation_persona WHERE conversation_id = ?").run(convo);
        const resolved = resolvePersona("");
        return { persona: resolved.persona, scope: "default", defaultPersonaId: readSettings().defaultPersonaId };
      }
      throw new LibraryError("Escopo inválido.", 400);
    },
    async search(query, limit = 8) {
      const q = sanitizeUntrusted(query, 200);
      const cap = Math.min(20, Math.max(1, Number(limit) || 8));
      const [memories, prompts, snippets] = await Promise.all([
        q ? searchMemories(q, "", cap) : Promise.resolve([]),
        q ? api.searchPrompts(q, cap) : Promise.resolve([]),
        q ? api.searchSnippets(q, "", cap) : Promise.resolve([]),
      ]);
      return { memories, prompts, snippets };
    },
    exportAll() {
      return {
        version: 1,
        exportedAt: nowIso(),
        settings: readSettings(),
        profile: readProfile(),
        memories: allMemories(),
        prompts: db.prepare("SELECT * FROM prompts").all().map(mapPrompt),
        snippets: db.prepare("SELECT * FROM snippets").all().map(mapSnippet),
        personas: listPersonas(),
        conversationPersonas: db.prepare("SELECT conversation_id, persona_id FROM conversation_persona").all(),
      };
    },
    async importAll(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new LibraryError("JSON de importação inválido.", 400);
      const redaction = { redacted: false, kinds: [] };
      const imported = { memories: 0, prompts: 0, snippets: 0, personas: 0 };
      if (data.profile && typeof data.profile === "object") {
        const saved = api.updateProfile(data.profile);
        mergeRedaction(redaction, saved.redaction);
      }
      if (data.settings && typeof data.settings === "object") {
        api.updateSettings({
          autoLearn: data.settings.autoLearn,
          embeddingModel: data.settings.embeddingModel,
          topK: data.settings.topK,
        });
      }
      for (const item of Array.isArray(data.prompts) ? data.prompts.slice(0, LIMITS.prompts) : []) {
        const saved = await api.createPrompt(item);
        mergeRedaction(redaction, saved.redaction);
        imported.prompts += 1;
      }
      for (const item of Array.isArray(data.snippets) ? data.snippets.slice(0, LIMITS.snippets) : []) {
        const saved = await api.createSnippet(item);
        mergeRedaction(redaction, saved.redaction);
        imported.snippets += 1;
      }
      for (const item of Array.isArray(data.memories) ? data.memories.slice(0, LIMITS.memories) : []) {
        const saved = await createMemory(item, { embedNow: false });
        mergeRedaction(redaction, saved.redaction);
        if (!saved.duplicate) imported.memories += 1;
      }
      for (const item of Array.isArray(data.personas) ? data.personas.slice(0, LIMITS.personas) : []) {
        if (item?.builtinKey) continue;
        const saved = api.createPersona(item);
        mergeRedaction(redaction, saved.redaction);
        imported.personas += 1;
      }
      return { imported, redaction };
    },
    close() {
      db.close();
    },
  };

  return api;
}

let singleton = null;

export function chatUserDir() {
  return process.env.MESTRE_CHAT_USER_DIR
    || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "chat-user");
}

export function getUserLibrary() {
  if (!singleton) singleton = createUserLibrary({ dir: chatUserDir() });
  return singleton;
}
