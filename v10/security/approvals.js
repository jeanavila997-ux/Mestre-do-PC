import { randomBytes } from "node:crypto";
import { sameToken } from "./session-gate.js";

export const APPROVAL_TTL_CAP_MS = 2 * 60 * 1000;

export function canonicalArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "{}";
  const keys = Object.keys(args).filter((key) => args[key] !== undefined).sort();
  const sorted = {};
  for (const key of keys) {
    const value = args[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sorted[key] = JSON.parse(canonicalArgs(value));
    } else {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

function publicView(item) {
  return {
    id: item.id,
    action: item.action,
    args: JSON.parse(item.args),
    requester: item.requester,
    status: item.status,
    expiresAt: new Date(item.expiresAt).toISOString(),
  };
}

/**
 * Aprovações humanas de uso único. A IA só cria o pedido (pending).
 * Permitir/Negar é outra operação, e consumir exige o estado approved
 * com a ação e os argumentos exatos.
 */
export function createApprovalStore({ ttlMs = APPROVAL_TTL_CAP_MS, now = () => Date.now() } = {}) {
  const ttl = Math.min(APPROVAL_TTL_CAP_MS, Math.max(1, Number(ttlMs) || APPROVAL_TTL_CAP_MS));
  const items = new Map();

  function find(id) {
    const key = String(id || "");
    for (const item of items.values()) {
      if (sameToken(item.id, key)) return item;
    }
    return null;
  }

  function sweep() {
    const t = now();
    for (const item of items.values()) {
      if ((item.status === "pending" || item.status === "approved") && item.expiresAt <= t) {
        item.status = "expired";
      }
    }
  }

  return {
    request({ action, args, requester = "mcp" }) {
      const acao = String(action || "").trim();
      if (!acao || acao.length > 80) return { ok: false, reason: "Ação inválida." };
      sweep();
      const id = randomBytes(32).toString("base64url");
      const item = {
        id,
        action: acao,
        args: canonicalArgs(args),
        requester: String(requester || "mcp").slice(0, 40),
        status: "pending",
        expiresAt: now() + ttl,
      };
      items.set(id, item);
      return { ok: true, ...publicView(item), approvalId: id };
    },
    listPending() {
      sweep();
      return [...items.values()].filter((item) => item.status === "pending").map(publicView);
    },
    get(id) {
      sweep();
      const item = find(id);
      if (!item) return null;
      return publicView(item);
    },
    permit(id) {
      sweep();
      const item = find(id);
      if (!item) return { ok: false, reason: "Aprovação não encontrada." };
      if (item.status === "expired") return { ok: false, reason: "Aprovação expirada." };
      if (item.status === "denied") return { ok: false, reason: "Aprovação já foi negada." };
      if (item.status === "consumed") return { ok: false, reason: "Aprovação já foi usada." };
      if (item.status === "approved") return { ok: true, ...publicView(item) };
      item.status = "approved";
      return { ok: true, ...publicView(item) };
    },
    deny(id) {
      sweep();
      const item = find(id);
      if (!item) return { ok: false, reason: "Aprovação não encontrada." };
      if (item.status === "expired") return { ok: false, reason: "Aprovação expirada." };
      if (item.status === "consumed") return { ok: false, reason: "Aprovação já foi usada." };
      if (item.status !== "pending" && item.status !== "approved") {
        return { ok: false, reason: "Aprovação não está pendente." };
      }
      item.status = "denied";
      return { ok: true, ...publicView(item) };
    },
    consume(id, action, args) {
      sweep();
      const item = find(id);
      if (!item) return { ok: false, reason: "Aprovação não encontrada." };
      if (item.status === "expired") return { ok: false, reason: "Aprovação expirada." };
      if (item.status === "denied") return { ok: false, reason: "Aprovação negada." };
      if (item.status === "consumed") return { ok: false, reason: "Aprovação já foi usada." };
      if (item.status !== "approved") return { ok: false, reason: "Aprovação ainda não foi permitida." };
      if (item.action !== String(action || "")) return { ok: false, reason: "Aprovação não corresponde à ação." };
      if (item.args !== canonicalArgs(args)) return { ok: false, reason: "Aprovação não corresponde ao comando." };
      item.status = "consumed";
      return { ok: true, ...publicView(item) };
    },
  };
}
