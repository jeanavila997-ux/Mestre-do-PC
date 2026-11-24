#!/usr/bin/env node
import { getLiveModels } from "../mcp-server/model-catalog.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const watchIndex = args.indexOf("--watch");
const watchSeconds = watchIndex >= 0 ? Number(args[watchIndex + 1]) : 0;
if (args.some((arg, index) => !["--json", "--watch"].includes(arg) && !(watchIndex >= 0 && index === watchIndex + 1))) {
  console.error("Uso: node scripts/modelos-disponiveis.mjs [--json] [--watch segundos]");
  process.exit(2);
}
if (watchIndex >= 0 && (!Number.isFinite(watchSeconds) || watchSeconds < 2 || watchSeconds > 3600)) {
  console.error("--watch exige um intervalo entre 2 e 3600 segundos.");
  process.exit(2);
}

async function showLiveModels() {
  const models = await getLiveModels({ baseUrl: process.env.OBSIDIAN_OLLAMA_URL || "http://127.0.0.1:11434" });
  if (asJson) {
    console.log(JSON.stringify({ source: "http://127.0.0.1:11434/api/tags", updatedAt: new Date().toISOString(), models }, null, 2));
    return;
  }
  console.log(`\nModelos Ollama disponíveis agora (${new Date().toLocaleString("pt-BR")})`);
  for (const model of models) {
    const size = model.size ? `${(model.size / 1e9).toFixed(2)} GB` : "tamanho n/d";
    console.log(`- ${model.name} | ${model.capability === "chat" ? "chat" : "embedding"} | ${size}`);
  }
  console.log(`Total: ${models.length} (${models.filter((model) => model.capability === "chat").length} chat, ${models.filter((model) => model.capability === "embedding").length} embedding)`);
}

do {
  try { await showLiveModels(); }
  catch (error) { console.error(`Erro: ${error.message}`); if (!watchSeconds) process.exitCode = 1; }
  if (watchSeconds) await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));
} while (watchSeconds);
