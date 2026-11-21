/**
 * turbo-pc.js — operação "turbo-pc" do Mestre do PC (revisão e melhoria do Windows).
 *
 * Duas ferramentas MCP, com classes fixas:
 *  - mestre_turbo_diagnostico (leitura): roda scripts/turbo-pc.ps1 -Modo diagnostico e
 *    devolve o JSON rotulado em pt-BR.
 *  - mestre_turbo_otimizar (destrutiva/execução): só roda com confirmar === true (ou "sim").
 *    Sem isso, devolve o que faria e NÃO executa nada. O script cria backup, desfazer.ps1,
 *    rodar-como-admin.ps1 e relatório; nunca esvazia a Lixeira nem apaga arquivos pessoais,
 *    modelos do Ollama ou o cache npm.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.MESTRE_PROJETO_PATH || join(__dirname, "..", "..");
export const TURBO_SCRIPT = join(PROJECT_ROOT, "scripts", "turbo-pc.ps1");
const TIMEOUT_MS = 10 * 60 * 1000;

export const TURBO_TOOL_CLASSES = Object.freeze({
  mestre_turbo_diagnostico: "read",
  mestre_turbo_otimizar: "destructive",
});

export const TURBO_O_QUE_FAZ = Object.freeze([
  "Limpar %TEMP% (arquivos com mais de 24h, pula os em uso)",
  "Limpar crash dumps com mais de 7 dias e miniaturas",
  "pnpm store prune, pip cache purge e uv cache prune (o cache npm não é tocado)",
  "Plano Alto desempenho quando na tomada (o anterior fica registrado)",
  "Preferência de GPU: IA (Ollama/llama/python) na RTX; navegadores, Obsidian, VS Code e Electron no iGPU",
  "Modo de Jogo ligado; efeitos visuais para desempenho mantendo fontes suaves",
  "Desativar só inicializações claramente dispensáveis (reversível)",
  "Gerar backup, desfazer.ps1, rodar-como-admin.ps1 e relatório",
]);

export function turboToolsDefinition() {
  return [
    {
      name: "mestre_turbo_diagnostico",
      description:
        "Turbo PC — diagnóstico SOMENTE LEITURA do Windows em pt-BR: RAM e top processos, memória virtual, disco e TRIM, tamanho de temporários e caches, inicialização, serviços, energia, GPU por app, Modo de Jogo e efeitos visuais. Copie os valores como vieram.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mestre_turbo_otimizar",
      description:
        "Turbo PC — aplica otimizações seguras e reversíveis (limpeza de temporários/caches, energia, GPU por app, efeitos visuais, inicialização). EXIGE confirmar=true depois do 'sim' do usuário; sem isso só mostra o que faria. Cria backup e desfazer.ps1. Nunca esvazia a Lixeira nem apaga arquivos pessoais ou modelos.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        type: "object",
        properties: {
          confirmar: { type: "boolean", description: "true somente depois que o usuário disse 'sim' explicitamente" },
        },
      },
    },
  ];
}

export function isTurboTool(name) {
  return Object.prototype.hasOwnProperty.call(TURBO_TOOL_CLASSES, name);
}

export function confirmacaoExplicita(valor) {
  return valor === true || (typeof valor === "string" && ["sim", "true"].includes(valor.trim().toLowerCase()));
}

export function buildTurboArgs(modo, { confirmar = false, pastaBackup = "" } = {}) {
  if (modo !== "diagnostico" && modo !== "otimizar") throw new Error(`Modo inválido: ${modo}`);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", TURBO_SCRIPT, "-Modo", modo];
  if (modo === "otimizar") {
    if (!confirmar) throw new Error("O modo otimizar exige confirmação explícita.");
    args.push("-Confirmar");
    if (pastaBackup) args.push("-PastaBackup", String(pastaBackup));
  }
  return args;
}

export function runTurboScript(modo, opts = {}, spawn = nodeSpawn) {
  const args = buildTurboArgs(modo, opts);
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const child = spawn("powershell.exe", args, { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("Turbo PC excedeu 10 minutos.")); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const inicio = out.indexOf("{");
      try {
        resolve(JSON.parse(out.slice(inicio >= 0 ? inicio : 0).trim()));
      } catch {
        reject(new Error(`Turbo PC terminou com código ${code} sem JSON válido. ${err.trim().slice(0, 400)}`));
      }
    });
  });
}

export async function callTurboTool(name, args = {}, spawn = nodeSpawn) {
  if (name === "mestre_turbo_diagnostico") return await runTurboScript("diagnostico", {}, spawn);
  if (name === "mestre_turbo_otimizar") {
    if (!confirmacaoExplicita(args.confirmar)) {
      return {
        ok: false,
        precisa_confirmacao: true,
        mensagem: "Nada foi executado. Mostre a lista ao usuário e só chame de novo com confirmar=true depois do 'sim'.",
        o_que_faria: [...TURBO_O_QUE_FAZ],
      };
    }
    return await runTurboScript("otimizar", { confirmar: true }, spawn);
  }
  throw new Error(`Ferramenta Turbo PC desconhecida: ${name}`);
}
