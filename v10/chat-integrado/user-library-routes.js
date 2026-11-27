/**
 * Rotas /api/user-library/* — memória, biblioteca e personas.
 * Autorização é a mesma isAuthorized do launcher. Não executa código salvo.
 */

import { LibraryError, getUserLibrary } from "./user-library.js";

const PREFIX = "/api/user-library";
const MAX_BODY = 256 * 1024;
const MAX_IMPORT = 1536 * 1024;

function send(res, status, data, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin || "http://127.0.0.1:7777",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Mestre-Client, X-Mestre-Extension-Token, X-Mestre-Npp-Token, X-Mestre-Mcp-Token",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(Object.assign(new Error("Corpo da requisição excede o limite."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("JSON inválido."), { status: 400 }));
      }
    });
    req.on("error", (err) => {
      if (!failed) reject(err);
    });
  });
}

function libraryOf(ctx) {
  return ctx.library || getUserLibrary();
}

/**
 * @returns {Promise<boolean>}
 */
export async function handleUserLibraryRoutes(req, res, url, ctx) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;

  const { isAuthorized, allowedOrigin } = ctx;
  if (typeof isAuthorized !== "function" || !isAuthorized(req)) {
    send(res, 403, { error: "Não autorizado." }, allowedOrigin);
    return true;
  }

  const lib = libraryOf(ctx);
  const method = req.method;
  const parts = path.slice(PREFIX.length).split("/").filter(Boolean);
  const head = parts[0] || "";
  const id = parts[1] || "";
  const action = parts[2] || "";

  try {
    if (head === "memories" && !id && method === "GET") {
      const type = url.searchParams.get("type") || "";
      const q = url.searchParams.get("q") || "";
      const memories = q || type ? await lib.searchMemories(q, type) : lib.listMemories();
      send(res, 200, { memories }, allowedOrigin);
      return true;
    }
    if (head === "memories" && !id && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      const saved = await lib.createMemory(body);
      send(res, saved.duplicate ? 200 : 201, saved, allowedOrigin);
      return true;
    }
    if (head === "memories" && id === "decision" && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 201, await lib.createDecision(body), allowedOrigin);
      return true;
    }
    if (head === "memories" && id && action === "pin" && method === "POST") {
      send(res, 200, await lib.togglePin(id), allowedOrigin);
      return true;
    }
    if (head === "memories" && id && !action && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.updateMemory(id, body), allowedOrigin);
      return true;
    }
    if (head === "memories" && id && !action && method === "DELETE") {
      send(res, 200, lib.deleteMemory(id), allowedOrigin);
      return true;
    }

    if (head === "settings" && method === "GET") {
      send(res, 200, { settings: lib.readSettings() }, allowedOrigin);
      return true;
    }
    if (head === "settings" && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, { settings: lib.updateSettings(body) }, allowedOrigin);
      return true;
    }
    if (head === "recall" && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.recall(body.query || "", body.k), allowedOrigin);
      return true;
    }
    if (head === "learn" && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.learnFromTurn(body), allowedOrigin);
      return true;
    }
    if (head === "prepare" && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.prepare({
        query: body.query || "",
        conversationId: body.conversationId || "",
        includePersonal: body.includePersonal !== false,
        topK: body.topK,
      }), allowedOrigin);
      return true;
    }
    if (head === "after-turn" && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.afterTurn(body), allowedOrigin);
      return true;
    }
    if (head === "audit" && method === "GET") {
      send(res, 200, { entries: lib.listAudit(url.searchParams.get("conversationId") || "", Number(url.searchParams.get("limit")) || 30) }, allowedOrigin);
      return true;
    }
    if (head === "search" && method === "GET") {
      send(res, 200, await lib.search(url.searchParams.get("q") || ""), allowedOrigin);
      return true;
    }
    if (head === "export" && method === "GET") {
      send(res, 200, lib.exportAll(), allowedOrigin);
      return true;
    }
    if (head === "import" && method === "POST") {
      const body = await readBody(req, MAX_IMPORT);
      send(res, 200, await lib.importAll(body), allowedOrigin);
      return true;
    }

    if (head === "prompts" && !id && method === "GET") {
      const q = url.searchParams.get("q") || "";
      send(res, 200, { prompts: q ? await lib.searchPrompts(q) : lib.listPrompts() }, allowedOrigin);
      return true;
    }
    if (head === "prompts" && !id && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      const saved = await lib.createPrompt(body);
      send(res, 201, saved, allowedOrigin);
      return true;
    }
    if (head === "prompts" && id && action === "favorite" && method === "POST") {
      send(res, 200, await lib.toggleFavorite(id), allowedOrigin);
      return true;
    }
    if (head === "prompts" && id && !action && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.updatePrompt(id, body), allowedOrigin);
      return true;
    }
    if (head === "prompts" && id && !action && method === "DELETE") {
      send(res, 200, lib.deletePrompt(id), allowedOrigin);
      return true;
    }

    if (head === "snippets" && id && action === "run") {
      send(res, 404, { error: "Scripts salvos não são executados. Use a whitelist do chat." }, allowedOrigin);
      return true;
    }
    if (head === "snippets" && !id && method === "GET") {
      const q = url.searchParams.get("q") || "";
      const language = url.searchParams.get("language") || "";
      send(res, 200, { snippets: q || language ? await lib.searchSnippets(q, language) : lib.listSnippets() }, allowedOrigin);
      return true;
    }
    if (head === "snippets" && !id && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 201, await lib.createSnippet(body), allowedOrigin);
      return true;
    }
    if (head === "snippets" && id && !action && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, await lib.updateSnippet(id, body), allowedOrigin);
      return true;
    }
    if (head === "snippets" && id && !action && method === "DELETE") {
      send(res, 200, lib.deleteSnippet(id), allowedOrigin);
      return true;
    }

    if (head === "profile" && method === "GET") {
      send(res, 200, { profile: lib.getProfile() }, allowedOrigin);
      return true;
    }
    if (head === "profile" && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, lib.updateProfile(body), allowedOrigin);
      return true;
    }

    if (head === "personas" && !id && method === "GET") {
      send(res, 200, { personas: lib.listPersonas() }, allowedOrigin);
      return true;
    }
    if (head === "personas" && !id && method === "POST") {
      const body = await readBody(req, MAX_BODY);
      send(res, 201, lib.createPersona(body), allowedOrigin);
      return true;
    }
    if (head === "personas" && id === "restore" && method === "POST") {
      send(res, 200, lib.restorePersonas(), allowedOrigin);
      return true;
    }
    if (head === "personas" && id && action === "duplicate" && method === "POST") {
      send(res, 201, lib.duplicatePersona(id), allowedOrigin);
      return true;
    }
    if (head === "personas" && id && !action && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, lib.updatePersona(id, body), allowedOrigin);
      return true;
    }
    if (head === "personas" && id && !action && method === "DELETE") {
      send(res, 200, lib.deletePersona(id), allowedOrigin);
      return true;
    }
    if (head === "active-persona" && method === "GET") {
      send(res, 200, lib.getActivePersona(url.searchParams.get("conversationId") || ""), allowedOrigin);
      return true;
    }
    if (head === "active-persona" && method === "PUT") {
      const body = await readBody(req, MAX_BODY);
      send(res, 200, lib.setActivePersona(body), allowedOrigin);
      return true;
    }

    send(res, 404, { error: "Rota da biblioteca não encontrada." }, allowedOrigin);
    return true;
  } catch (err) {
    const status = err instanceof LibraryError || err?.status ? err.status : 500;
    send(res, status, { error: err.message || "Falha na biblioteca." }, allowedOrigin);
    return true;
  }
}
