(function () {
  var box = document.getElementById("aprovacoesPendentes");
  if (!box) return;

  function headers() {
    return { "Content-Type": "application/json", "X-Mestre-Client": "v10-web" };
  }

  function texto(item) {
    var args = item.args || {};
    if (item.action === "definir_modo_livre") return "A IA pediu para ligar o Modo Livre.";
    if (item.action === "executar_comando_livre") return "A IA pediu para executar este comando fora da whitelist: " + (args.cmd || "");
    if (item.action === "run") return "A IA pediu para executar a operação da whitelist: " + (args.id || "");
    if (item.action === "gerar_snapshot_git") return "A IA pediu para criar um snapshot git: " + (args.mensagem_commit || "");
    if (item.action === "congelar_tabela_final") return "A IA pediu para congelar a tabela: " + (args.nome_tabela || "");
    return "A IA pediu uma aprovação.";
  }

  function render(items) {
    box.replaceChildren();
    if (!items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    for (const item of items) {
      var card = document.createElement("article");
      card.className = "aprovacao-card";
      var title = document.createElement("p");
      title.className = "aprovacao-texto";
      title.textContent = texto(item);
      var meta = document.createElement("p");
      meta.className = "aprovacao-meta";
      var restante = Math.max(0, Math.round((Date.parse(item.expiresAt) - Date.now()) / 1000));
      meta.textContent = "Pedido de " + (item.requester || "mcp") + " · expira em " + restante + "s";
      var actions = document.createElement("div");
      actions.className = "aprovacao-acoes";
      var permitir = document.createElement("button");
      permitir.type = "button";
      permitir.className = "aprovacao-permitir";
      permitir.textContent = "Permitir";
      permitir.addEventListener("click", function () { decidir(item.id, "permitir"); });
      var negar = document.createElement("button");
      negar.type = "button";
      negar.className = "aprovacao-negar";
      negar.textContent = "Negar";
      negar.addEventListener("click", function () { decidir(item.id, "negar"); });
      actions.append(permitir, negar);
      card.append(title, meta, actions);
      box.append(card);
    }
  }

  async function decidir(id, acao) {
    try {
      await fetch("/aprovacoes/" + encodeURIComponent(id) + "/" + acao, { method: "POST", headers: headers(), body: "{}" });
    } catch { /* a próxima leitura mostra o estado */ }
    carregar();
  }

  async function carregar() {
    try {
      var res = await fetch("/aprovacoes/pendentes", { headers: headers() });
      if (!res.ok) { box.hidden = true; return; }
      var data = await res.json();
      render(Array.isArray(data.pendentes) ? data.pendentes : []);
    } catch {
      box.hidden = true;
    }
  }

  carregar();
  setInterval(carregar, 2000);
})();
