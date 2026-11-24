const MAX_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 8 * 1024;
const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 60_000;

const types = ["task", "knowledge", "decision", "resource", "agent", "workflow", "validation", "output"];
const priorities = ["low", "medium", "high", "critical"];
const slugSchema = { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]*$" };
const geneSchema = {
  type: "object",
  properties: {
    key: { type: "string" }, title: { type: "string" }, type: { type: "string", enum: types },
    objective: { type: "string" }, depends_on: { type: "array", items: { type: "string" } },
    priority: { type: "string", enum: priorities },
  },
  required: ["key", "title", "type", "objective", "depends_on", "priority"],
  additionalProperties: false,
};
const planSchema = {
  type: "object",
  properties: {
    name: { type: "string" }, slug: slugSchema, objective: { type: "string" },
    summary: { type: "string" },
    genes: { type: "array", minItems: 1, maxItems: 100, items: geneSchema },
  },
  required: ["name", "slug", "objective", "summary", "genes"],
  additionalProperties: false,
};
const generatedIdSchema = { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{0,63}$" };
const generatedTextSchema = { type: "string", minLength: 1, maxLength: 10000, pattern: "\\S" };
const generatedPlanSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    objective: generatedTextSchema,
    summary: generatedTextSchema,
    genes: {
      type: "array", minItems: 1, maxItems: 100, items: {
        type: "object",
        properties: {
          key: generatedIdSchema,
          title: { type: "string", minLength: 1, maxLength: 120 },
          type: { type: "string", enum: types },
          objective: generatedTextSchema,
          depends_on: { type: "array", uniqueItems: true, items: generatedIdSchema },
          priority: { type: "string", enum: priorities },
        },
        required: ["key", "title", "type", "objective", "depends_on", "priority"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "objective", "summary", "genes"],
  additionalProperties: false,
};
const plannerSystemPrompt = `Planeje em português brasileiro e retorne somente JSON conforme o schema.
Não inclua slug, caminhos ou outros campos. name e cada title devem ser nomes de arquivo seguros de 1 a 120 caracteres, normalizados em NFC; não use <>:"/\\|?*[]#^, caracteres de controle, espaços nas extremidades ou ponto final. Evite também caracteres que se tornem proibidos após normalização NFKC. Não use nomes reservados do Windows (CON, PRN, AUX, NUL, COM1 a COM9, LPT1 a LPT9, inclusive com extensão ou algarismos sobrescritos) nem .obsidian, .git, .trash ou node_modules. Os títulos dos genes devem ser distintos mesmo após normalização NFKC e conversão para minúsculas.
Cada key deve ter de 1 a 64 caracteres ASCII, começar com letra minúscula ou dígito e conter apenas letras minúsculas, dígitos e hífens (exemplo: etapa-1; nunca etapa_1). Não use nomes reservados do Windows. Keys devem ser únicas. depends_on contém apenas keys existentes e únicas, sem dependência do próprio gene e sem ciclos.
objective e summary devem ser textos não vazios com no máximo 10000 caracteres, assim como objective de cada gene. Inclua entre 1 e 100 genes.`;
const input = (properties, required = []) => ({
  type: "object", properties, required, additionalProperties: false,
});

export const operonToolSchemas = [
  { name: "operon_plan", description: "Planeja um Operon com Ollama, sem criar arquivos. O slug é informado pelo usuário ou derivado do objetivo.", inputSchema: input({ slug: slugSchema, objective: { type: "string", minLength: 1 }, constraints: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 30 } }, ["objective"]) },
  { name: "operon_create", description: "Cria um Operon no vault configurado; dry_run deve ser informado explicitamente.", inputSchema: input({ plan: planSchema, dry_run: { type: "boolean" } }, ["plan", "dry_run"]) },
  { name: "operon_validate", description: "Valida e normaliza um plano de Operon.", inputSchema: input({ plan: planSchema }, ["plan"]) },
  { name: "operon_render_canvas", description: "Renderiza um Canvas, preservando dados de um Canvas existente quando fornecido.", inputSchema: input({ plan: planSchema, existing: { type: "object" } }, ["plan"]) },
  { name: "operon_get", description: "Obtém o manifesto de um Operon pelo slug.", inputSchema: input({ slug: slugSchema }, ["slug"]) },
  { name: "operon_list", description: "Lista os Operons do vault configurado.", inputSchema: input({}) },
];

const names = new Set(operonToolSchemas.map((tool) => tool.name));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (obj, allowed, required) => isObject(obj) &&
  Object.keys(obj).every((key) => allowed.includes(key)) &&
  required.every((key) => Object.hasOwn(obj, key));
const text = (value) => typeof value === "string" && value.trim().length > 0;
const slugValid = (value) => text(value) && value.length <= 64 &&
  /^[a-z0-9][a-z0-9-]*$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
const withinLimit = (value, limit = MAX_BYTES) => {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= limit; } catch { return false; }
};

function validPlan(plan) {
  return exact(plan, ["name", "slug", "objective", "summary", "genes"], ["name", "slug", "objective", "summary", "genes"]) &&
    slugValid(plan.slug) && text(plan.name) && text(plan.objective) && text(plan.summary) &&
    Array.isArray(plan.genes) && plan.genes.length >= 1 && plan.genes.length <= 100 &&
    plan.genes.every((gene) =>
      exact(gene, ["key", "title", "type", "objective", "depends_on", "priority"], ["key", "title", "type", "objective", "depends_on", "priority"]) &&
      text(gene.key) && text(gene.title) && types.includes(gene.type) && text(gene.objective) &&
      Array.isArray(gene.depends_on) && gene.depends_on.every(text) && priorities.includes(gene.priority)) &&
    withinLimit(plan);
}

function validArgs(name, args) {
  if (!withinLimit(args)) return false;
  switch (name) {
    case "operon_plan":
      return exact(args, ["slug", "objective", "constraints"], ["objective"]) &&
        (!Object.hasOwn(args, "slug") || slugValid(args.slug)) && text(args.objective) &&
        (!Object.hasOwn(args, "constraints") || (Array.isArray(args.constraints) && args.constraints.length <= 30 && args.constraints.every(text))) &&
        withinLimit({ objective: args.objective, constraints: args.constraints }, MAX_PROMPT_BYTES);
    case "operon_create":
      return exact(args, ["plan", "dry_run"], ["plan", "dry_run"]) && validPlan(args.plan) && typeof args.dry_run === "boolean";
    case "operon_validate":
      return exact(args, ["plan"], ["plan"]) && validPlan(args.plan);
    case "operon_render_canvas":
      return exact(args, ["plan", "existing"], ["plan"]) && validPlan(args.plan) &&
        (!Object.hasOwn(args, "existing") || isObject(args.existing));
    case "operon_get":
      return exact(args, ["slug"], ["slug"]) && slugValid(args.slug);
    case "operon_list":
      return exact(args, [], []);
    default:
      return false;
  }
}

async function readBoundedBody(response, limit) {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) throw new Error("size");
  if (!response.body) throw new Error("body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("size");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    // Não aguardar cancelamento: um produtor travado não deve prolongar o timeout.
    reader.cancel().catch(() => {});
  }
}

class InvalidPlanError extends Error {}

function parsePlanJson(value) {
  try { return JSON.parse(value); } catch { throw new InvalidPlanError(); }
}

async function requestPlan({ objective, constraints = [], slug }, config, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await config.fetch(config.url + (config.url.endsWith("/api") ? "/chat" : "/api/chat"), {
        method: "POST",
        headers: config.headers(),
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model, options: config.options(), keep_alive: config.keepAlive,
          stream: false, think: false, format: generatedPlanSchema,
          messages: [
            { role: "system", content: plannerSystemPrompt },
            { role: "user", content: JSON.stringify({ objective, constraints }) },
          ],
        }),
      });
      if (controller.signal.aborted) throw new Error("timeout");
      if (!response.ok) throw new Error("http");
      const envelope = parsePlanJson(await readBoundedBody(response, MAX_BYTES));
      if (!isObject(envelope) || !isObject(envelope.message) || typeof envelope.message.content !== "string") throw new InvalidPlanError();
      const generated = parsePlanJson(envelope.message.content);
      if (!exact(generated, ["name", "objective", "summary", "genes"], ["name", "objective", "summary", "genes"])) throw new InvalidPlanError();
      let derivedSlug = objective.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "") || "operon";
      if (!slugValid(derivedSlug)) derivedSlug = "operon-" + derivedSlug.slice(0, 57);
      const plan = { ...generated, slug: slug ?? derivedSlug };
      if (!validPlan(plan)) throw new InvalidPlanError();
      return plan;
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const failure = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

export function createOperonMcp({ domain, guard, audit, ollama, timeoutMs = TIMEOUT_MS }) {
  let active = 0;
  const record = async (name, status) => {
    try { await audit(name, status); } catch { /* auditoria não altera o resultado */ }
  };
  return {
    isTool: (name) => names.has(name),
    async callTool(name, rawArgs) {
      const args = rawArgs === undefined ? {} : rawArgs;
      if (!names.has(name)) return failure("Ferramenta Operon desconhecida.");
      if (!validArgs(name, args)) {
        await record(name, "argumentos_invalidos");
        return failure("Argumentos Operon inválidos.");
      }
      if (active >= MAX_CONCURRENT) {
        await record(name, "limite_concorrencia");
        return failure("Limite de chamadas Operon simultâneas atingido.");
      }
      active++;
      let status = "erro";
      try {
        let value;
        switch (name) {
          case "operon_plan": {
            const blocked = await guard([args.objective, ...(args.constraints || [])].join("\n"), name);
            if (blocked) { status = "bloqueado"; return blocked; }
            const plan = await requestPlan(args, ollama, timeoutMs);
            try { value = await domain.validateOperon(plan); }
            catch { throw new InvalidPlanError(); }
            break;
          }
          case "operon_create":
            value = await domain.createOperon(args.plan, { dryRun: args.dry_run });
            break;
          case "operon_validate":
            value = await domain.validateOperon(args.plan);
            break;
          case "operon_render_canvas":
            value = await domain.renderCanvas(args.plan, args.existing);
            break;
          case "operon_get":
            value = await domain.getOperon(args.slug);
            break;
          case "operon_list":
            value = await domain.listOperons();
            break;
        }
        status = "sucesso";
        return result(value);
      } catch (error) {
        if (error instanceof InvalidPlanError) {
          status = "plano_invalido";
          return failure("O Ollama retornou um plano inválido. Tente novamente.");
        }
        if (name === "operon_create" && typeof error?.message === "string" &&
            error.message.startsWith("Falha no rollback; backups preservados e estado incompleto")) {
          status = "rollback_incompleto";
          return failure("Falha no rollback; backups preservados e estado incompleto. Recupere os backups antes de continuar.");
        }
        return failure(name === "operon_plan"
          ? "Não foi possível gerar um plano válido com o Ollama (resposta inválida, indisponibilidade ou timeout)."
          : "Operação Operon falhou. Verifique o plano e a disponibilidade do vault configurado.");
      } finally {
        active--;
        await record(name, status);
      }
    },
  };
}
