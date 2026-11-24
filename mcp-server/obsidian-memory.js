import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules", "referencias", "chaves", "cofre", "cofre remoto", "_arquivo",
  "temp", "tmp", "logs", "data", "dist", "build", ".git", ".obsidian",
]);
const EXCLUDED_FILES = new Set([".env.md", "db_config.md", "credentials.md", "secrets.md", "senhas.md", "tokens.md"]);

function resolveOptions(options = {}) {
  const home = resolve(process.env.USERPROFILE || process.env.HOME || "");
  const vaultPath = resolve(options.vaultPath || process.env.OBSIDIAN_VAULT_PATH || join(home, "Projetos"));
  const relativeVault = relative(home, vaultPath);
  if (!home || relativeVault.startsWith("..") || isAbsolute(relativeVault)) {
    throw new Error("O vault do Obsidian deve estar dentro da pasta do usuário.");
  }
  if (vaultPath.split(/[\\/]/).some((part) => ["cofre", "cofre remoto", ".ssh", ".mcp-auth"].includes(part.toLowerCase()))) {
    throw new Error("O vault configurado aponta para uma pasta protegida.");
  }
  const ollamaUrl = String(options.ollamaUrl || process.env.OBSIDIAN_OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const parsedOllama = new URL(ollamaUrl);
  if (parsedOllama.protocol !== "http:" || parsedOllama.hostname !== "127.0.0.1" || parsedOllama.username || parsedOllama.password) {
    throw new Error("A memória Obsidian exige um Ollama local em http://127.0.0.1; nenhuma nota foi enviada.");
  }
  return {
    vaultPath,
    storeDir: resolve(options.storeDir || process.env.MESTRE_OBSIDIAN_INDEX_DIR || join(__dirname, "..", "v10", "data", "memories")),
    ollamaUrl,
    model: String(options.model || process.env.OBSIDIAN_EMBED_MODEL || DEFAULT_MODEL),
    fetchImpl: options.fetchImpl || fetch,
    maxFiles: Math.min(Math.max(1, Number(options.maxFiles) || 5000), 20000),
    maxFileBytes: Math.min(Math.max(1024, Number(options.maxFileBytes) || 2 * 1024 * 1024), 10 * 1024 * 1024),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function headingAt(text, position) {
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .filter((match) => match.index <= position)
    .map((match) => match[1].trim());
  return headings.at(-1) || null;
}

export function chunkMarkdown(text, options = {}) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const maxChars = Math.min(Math.max(50, Number(options.maxChars) || 1200), 4000);
  const overlap = Math.min(Math.max(0, Number(options.overlap) || 150), Math.floor(maxChars / 2));
  if (!source.trim()) return [];
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + maxChars, source.length);
    if (end < source.length) {
      const minimumBreak = start + Math.floor(maxChars * 0.65);
      const whitespace = source.slice(minimumBreak, end).search(/\s/);
      if (whitespace >= 0) end = minimumBreak + whitespace;
    }
    const raw = source.slice(start, end);
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const content = raw.trim();
    const actualStart = start + leadingWhitespace;
    if (content) {
      chunks.push({ text: content, start: actualStart, end: actualStart + content.length, heading: headingAt(source, actualStart) });
    }
    if (end >= source.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    throw new Error("Os vetores precisam ter dimensões iguais e não vazias.");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (!Number.isFinite(a[index]) || !Number.isFinite(b[index])) throw new Error("Vetor contém valor inválido.");
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function isExcludedDirectory(name) {
  const lower = name.toLowerCase();
  return name.startsWith(".") || EXCLUDED_DIRECTORIES.has(lower);
}

async function listMarkdownFiles(config) {
  const files = [];
  let skippedFiles = 0;
  async function walk(directory, depth) {
    if (depth > 12) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedFiles += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (isExcludedDirectory(entry.name)) skippedFiles += 1;
        else await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      if (entry.name.startsWith(".env") || EXCLUDED_FILES.has(entry.name.toLowerCase())) {
        skippedFiles += 1;
        continue;
      }
      if (files.length >= config.maxFiles) {
        skippedFiles += 1;
        continue;
      }
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > config.maxFileBytes) {
        skippedFiles += 1;
        continue;
      }
      files.push({ absolute, relative: relative(config.vaultPath, absolute).replaceAll("\\", "/"), metadata });
    }
  }
  const rootMetadata = await lstat(config.vaultPath);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("OBSIDIAN_VAULT_PATH não aponta para uma pasta válida.");
  await walk(config.vaultPath, 0);
  files.sort((a, b) => a.relative.localeCompare(b.relative, "en"));
  return { files, skippedFiles };
}

function emptyIndex(model) {
  return { version: 1, model, updatedAt: null, files: {}, chunks: [] };
}

async function readIndex(config) {
  try {
    const raw = await readFile(join(config.storeDir, "obsidian-index.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !parsed.files || !Array.isArray(parsed.chunks)) throw new Error("formato");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return emptyIndex(config.model);
    throw new Error("O índice local do Obsidian está inválido; nenhum dado foi sobrescrito.");
  }
}

async function embedTexts(texts, config) {
  if (texts.length === 0) return [];
  let response;
  try {
    response = await config.fetchImpl(`${config.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input: texts }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw new Error(`Não foi possível contatar o Ollama: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Ollama retornou HTTP ${response.status} ao gerar embeddings.`);
  const payload = await response.json();
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
    throw new Error("Ollama retornou uma quantidade inesperada de embeddings.");
  }
  const dimension = Array.isArray(payload.embeddings[0]) ? payload.embeddings[0].length : 0;
  if (dimension === 0) throw new Error("Ollama retornou embedding vazio.");
  for (const vector of payload.embeddings) {
    if (!Array.isArray(vector) || vector.length !== dimension || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Ollama retornou embeddings com dimensões inconsistentes.");
    }
  }
  return payload.embeddings;
}

async function writeIndex(config, index) {
  await mkdir(config.storeDir, { recursive: true });
  const target = join(config.storeDir, "obsidian-index.json");
  const temporary = join(config.storeDir, `.obsidian-index-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(index), "utf8");
  await rename(temporary, target);
}

export async function syncObsidian(options = {}) {
  const config = resolveOptions(options);
  const previous = await readIndex(config);
  const sameModel = previous.model === config.model;
  const { files, skippedFiles } = await listMarkdownFiles(config);
  const nextFiles = {};
  const chunks = [];
  const pending = [];
  let reusedChunks = 0;

  for (const file of files) {
    const content = await readFile(file.absolute, "utf8");
    const hash = sha256(content);
    const modifiedAt = file.metadata.mtime.toISOString();
    nextFiles[file.relative] = { hash, size: file.metadata.size, mtimeMs: file.metadata.mtimeMs, modifiedAt };
    const oldChunks = sameModel ? previous.chunks.filter((chunk) => chunk.source === file.relative) : [];
    if (sameModel && previous.files[file.relative]?.hash === hash && oldChunks.length > 0) {
      for (const chunk of oldChunks) {
        chunks.push({ ...chunk, modifiedAt });
        reusedChunks += 1;
      }
      continue;
    }
    const fileChunks = chunkMarkdown(content);
    for (let index = 0; index < fileChunks.length; index += 1) {
      const chunk = fileChunks[index];
      pending.push({
        id: `${hash}:${index}`,
        source: file.relative,
        heading: chunk.heading,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        hash,
        modifiedAt,
        embedding: null,
      });
    }
  }

  const batchSize = 16;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.text), config);
    for (let index = 0; index < batch.length; index += 1) batch[index].embedding = embeddings[index];
  }
  chunks.push(...pending);
  chunks.sort((a, b) => a.source.localeCompare(b.source, "en") || a.start - b.start || a.id.localeCompare(b.id));
  const dimension = chunks[0]?.embedding?.length || 0;
  if (chunks.some((chunk) => !Array.isArray(chunk.embedding) || chunk.embedding.length !== dimension)) {
    throw new Error("O índice contém vetores com dimensões inconsistentes; nada foi gravado.");
  }

  const currentPaths = new Set(files.map((file) => file.relative));
  const removedFiles = Object.keys(previous.files).filter((path) => !currentPaths.has(path)).length;
  const next = { version: 1, model: config.model, updatedAt: new Date().toISOString(), files: nextFiles, chunks };
  await writeIndex(config, next);
  return {
    success: true,
    model: config.model,
    indexedFiles: files.length,
    totalChunks: chunks.length,
    embeddedChunks: pending.length,
    reusedChunks,
    removedFiles,
    skippedFiles,
    updatedAt: next.updatedAt,
  };
}

export async function searchObsidian(query, options = {}) {
  const text = String(query || "").trim();
  if (text.length < 2 || text.length > 500) throw new Error("Informe uma consulta entre 2 e 500 caracteres.");
  const config = resolveOptions(options);
  const index = await readIndex(config);
  const limit = Math.min(Math.max(1, Math.floor(Number(options.limit) || 5)), 10);
  if (index.chunks.length === 0) {
    return { query: text, model: config.model, totalChunks: 0, results: [], message: "Índice vazio ou inexistente. Execute sync_obsidian primeiro." };
  }
  if (index.model !== config.model) throw new Error("O modelo do índice mudou. Execute sync_obsidian antes de pesquisar.");
  const [queryEmbedding] = await embedTexts([text], config);
  const scored = [];
  for (const chunk of index.chunks) {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== queryEmbedding.length) continue;
    scored.push({
      score: Number(cosineSimilarity(queryEmbedding, chunk.embedding).toFixed(6)),
      source: chunk.source,
      modifiedAt: chunk.modifiedAt,
      heading: chunk.heading || null,
      text: String(chunk.text).slice(0, 1600),
      contentType: "untrusted_obsidian_note",
      start: chunk.start,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source, "en") || a.start - b.start);
  return { query: text, model: config.model, totalChunks: index.chunks.length, results: scored.slice(0, limit) };
}
