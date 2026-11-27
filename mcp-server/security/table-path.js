import { resolve, sep } from "node:path";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.csv$/i;

export function resolveTablePath(dir, nomeTabela) {
  if (!dir) return { ok: false, reason: "Diretório de tabelas não configurado." };
  const raw = String(nomeTabela || "").trim();
  if (!raw || raw.includes("..") || raw.includes("/") || raw.includes("\\") || raw.includes("\0")) {
    return { ok: false, reason: "Nome de tabela inválido." };
  }
  const fileName = raw.toLowerCase().endsWith(".csv") ? raw : `${raw}.csv`;
  if (!NAME_RE.test(fileName)) return { ok: false, reason: "Nome de tabela inválido." };
  const base = resolve(dir);
  const full = resolve(base, fileName);
  const root = base.endsWith(sep) ? base : base + sep;
  if (!full.startsWith(root)) return { ok: false, reason: "Caminho fora do diretório de tabelas." };
  return { ok: true, filePath: full };
}
