import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalStore } from "./approvals.js";

function store(now = () => 1_000_000) {
  return createApprovalStore({ ttlMs: 1_000, now });
}

test("permitir, negar, reuso, comando diferente e expiração", () => {
  let now = 1_000_000;
  const approvals = store(() => now);
  const pedido = approvals.request({ action: "executar_comando_livre", args: { cmd: "Get-Date" }, requester: "mcp" });
  assert.equal(pedido.ok, true);
  assert.equal(approvals.listPending().length, 1);

  assert.equal(approvals.consume(pedido.approvalId, "executar_comando_livre", { cmd: "Get-Date" }).ok, false);

  assert.equal(approvals.permit(pedido.approvalId).ok, true);
  assert.match(approvals.consume(pedido.approvalId, "executar_comando_livre", { cmd: "Get-Process" }).reason, /comando/);
  assert.equal(approvals.get(pedido.approvalId).status, "approved");
  assert.equal(approvals.consume(pedido.approvalId, "executar_comando_livre", { cmd: "Get-Date" }).ok, true);
  assert.match(approvals.consume(pedido.approvalId, "executar_comando_livre", { cmd: "Get-Date" }).reason, /usada/);

  const outro = approvals.request({ action: "definir_modo_livre", args: { enabled: true }, requester: "mcp" });
  assert.equal(approvals.deny(outro.approvalId).ok, true);
  assert.match(approvals.permit(outro.approvalId).reason, /negada/);

  const expira = approvals.request({ action: "run", args: { id: "x", params: {} }, requester: "mcp" });
  now += 5_000;
  assert.match(approvals.permit(expira.approvalId).reason, /expirada/);
  assert.equal(approvals.listPending().length, 0);
});
