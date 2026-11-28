/**
 * Painéis Memória e Biblioteca do Chat Integrado.
 * O store fica no launcher; este arquivo só fala com /api/user-library.
 */

import { applyPromptTemplate, templateVars } from "./user-library-pure.js";

function $(id) {
  return document.getElementById(id);
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className || "lib-btn";
  el.textContent = label;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return el;
}

function emptyNote(text) {
  const note = document.createElement("p");
  note.className = "lib-empty";
  note.textContent = text;
  return note;
}

export function initUserLibraryUi({
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  openModal,
  getState,
  reloadProfiles,
  closeMenus,
}) {
  let personas = [];
  let pendingPersonaId = "";
  let editingPromptId = "";
  let editingPersonaId = "";
  let searchTimer = 0;

  async function tell(title, body) {
    await openModal({ title, body: String(body || ""), cancelText: "", okText: "Entendi" });
  }

  async function warnRedaction(result) {
    if (!result?.redaction?.redacted) return;
    const kinds = (result.redaction.kinds || []).join(", ") || "segredo";
    await tell("Segredo removido", `Algo parecia ${kinds} e foi ocultado antes de salvar.`);
  }

  function fail(result, fallback) {
    return result?.error ? result.error : fallback;
  }

  async function refreshPersonaSelect(conversationId = "") {
    const select = $("personaSelect");
    if (!select) return;
    const [list, active] = await Promise.all([
      apiGet("/api/user-library/personas").catch(() => null),
      apiGet(`/api/user-library/active-persona?conversationId=${encodeURIComponent(conversationId || "")}`).catch(() => null),
    ]);
    if (!list?.personas) return;
    personas = list.personas;
    const previous = select.value;
    select.replaceChildren();
    for (const persona of personas) {
      const option = document.createElement("option");
      option.value = persona.id;
      option.textContent = persona.name;
      select.appendChild(option);
    }
    const chosen = pendingPersonaId || active?.persona?.id || previous;
    if (chosen && personas.some((persona) => persona.id === chosen)) select.value = chosen;
    const scope = $("personaScope");
    if (!scope) return;
    if (!conversationId && pendingPersonaId) scope.textContent = "nesta conversa, ao enviar";
    else if (conversationId && active?.scope === "conversation") scope.textContent = "nesta conversa";
    else scope.textContent = "padrão";
  }

  async function onConversation(conversationId) {
    if (!conversationId) pendingPersonaId = "";
    else if (pendingPersonaId) {
      const personaId = pendingPersonaId;
      pendingPersonaId = "";
      await apiPut("/api/user-library/active-persona", {
        personaId,
        scope: "conversation",
        conversationId,
      }).catch(() => null);
    }
    await refreshPersonaSelect(conversationId || "");
    if ($("learningPanel")?.classList.contains("show")) loadAudit();
  }

  async function maybeSuggestProfile(persona) {
    const profile = persona?.suggestedProfile;
    if (!profile) return;
    const state = getState();
    if (state.perfilAtivo === profile && !state.provedorAtivo) return;
    const known = (state.perfis || []).find((item) => item.id === profile);
    const label = known?.label || profile;
    const model = known?.model ? ` O modelo efetivo, já com o que foi salvo no editor de perfis, é ${known.model}.` : "";
    const ok = await openModal({
      title: "Perfil sugerido",
      body: `A persona "${persona.name}" sugere o perfil "${label}".${model} Ativar agora? A persona continua valendo mesmo se você recusar.`,
      okText: "Ativar perfil",
      cancelText: "Agora não",
    });
    if (!ok) return;
    const result = await apiPost("/api/profiles/activate", { perfil: profile });
    if (result?.error) {
      await tell("Perfil", result.error);
      return;
    }
    if (reloadProfiles) await reloadProfiles();
  }

  function fillSuggestedProfiles(selected = "") {
    const select = $("personaProfile");
    if (!select) return;
    const current = selected || select.value;
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Nenhum (continua no modelo atual)";
    select.append(none);
    for (const profile of getState().perfis || []) {
      const option = document.createElement("option");
      option.value = String(profile.id);
      option.textContent = profile.model
        ? `${profile.label || profile.id} · ${profile.model}`
        : String(profile.label || profile.id);
      select.append(option);
    }
    if (current && ![...select.options].some((option) => option.value === current)) {
      const extra = document.createElement("option");
      extra.value = current;
      extra.textContent = current;
      select.append(extra);
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  async function onPersonaPicked() {
    const personaId = $("personaSelect")?.value;
    const persona = personas.find((item) => item.id === personaId);
    if (!persona) return;
    const conversationId = getState().conversaId;
    if (conversationId) {
      const saved = await apiPut("/api/user-library/active-persona", {
        personaId,
        scope: "conversation",
        conversationId,
      });
      if (saved?.error) return tell("Persona", saved.error);
      const scope = $("personaScope");
      if (scope) scope.textContent = "nesta conversa";
    } else {
      pendingPersonaId = personaId;
      const scope = $("personaScope");
      if (scope) scope.textContent = "nesta conversa, ao enviar";
    }
    await maybeSuggestProfile(persona);
  }

  function renderMemories(items) {
    const list = $("learningList");
    if (!list) return;
    list.replaceChildren();
    if (!items?.length) {
      list.append(emptyNote("Nenhuma memória neste filtro."));
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "memory-item";
      const content = document.createElement("div");
      content.className = "mem-content";
      const title = document.createElement("div");
      title.className = "mem-title";
      title.textContent = `${item.pinned ? "📌 " : ""}${item.type}`;
      const text = document.createElement("div");
      text.className = "mem-text";
      text.textContent = item.text;
      const meta = document.createElement("div");
      meta.className = "mem-text";
      meta.textContent = [item.model, item.createdAt?.slice(0, 16).replace("T", " ")].filter(Boolean).join(" · ");
      content.append(title, text, meta);
      const actions = document.createElement("div");
      actions.className = "mem-actions";
      actions.append(
        button(item.pinned ? "Desafixar" : "Fixar", "", async () => {
          await apiPost(`/api/user-library/memories/${item.id}/pin`, {});
          loadMemories();
        }),
        button("Editar", "", () => editMemory(item)),
        button("Apagar", "del", () => removeMemory(item)),
      );
      row.append(content, actions);
      list.append(row);
    }
  }

  async function loadMemories() {
    const q = $("learningSearch")?.value.trim() || "";
    const type = $("learningType")?.value || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    const suffix = params.toString() ? `?${params}` : "";
    const data = await apiGet(`/api/user-library/memories${suffix}`).catch(() => null);
    if (data?.error) return;
    renderMemories(data?.memories || []);
  }

  async function loadAudit() {
    const box = $("learningAudit");
    if (!box) return;
    const conversationId = getState().conversaId;
    if (!conversationId) {
      box.textContent = "Abra uma conversa para ver modelo, persona e memórias usadas.";
      return;
    }
    const data = await apiGet(`/api/user-library/audit?conversationId=${encodeURIComponent(conversationId)}&limit=8`).catch(() => null);
    const entries = (data?.entries || []).filter((entry) => entry.role === "assistant");
    if (!entries.length) {
      box.textContent = "Ainda não há registro nesta conversa.";
      return;
    }
    box.replaceChildren();
    for (const entry of entries) {
      const line = document.createElement("div");
      const memories = (entry.memories || []).map((item) => item.type).join(", ") || "nenhuma";
      line.textContent = `${entry.createdAt?.slice(11, 16) || ""} · modelo ${entry.model || "—"} · persona ${entry.personaName || "—"} · memórias ${memories}`;
      box.append(line);
    }
  }

  async function editMemory(item) {
    const text = await openModal({
      title: "Editar memória",
      body: "O texto é dado, não uma ordem para o modelo.",
      mode: "prompt",
      useTextarea: true,
      value: item.text,
      okText: "Salvar",
    });
    if (text == null) return;
    const saved = await apiPut(`/api/user-library/memories/${item.id}`, { text });
    if (saved?.error) return tell("Memória", saved.error);
    await warnRedaction(saved);
    loadMemories();
  }

  async function removeMemory(item) {
    const ok = await openModal({ title: "Apagar memória", body: "Apagar esta memória?", okText: "Apagar" });
    if (!ok) return;
    await apiDelete(`/api/user-library/memories/${item.id}`);
    loadMemories();
  }

  function renderPrompts(items) {
    const list = $("promptList");
    if (!list) return;
    list.replaceChildren();
    if (!items?.length) {
      list.append(emptyNote("Nenhum prompt salvo."));
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "memory-item";
      const content = document.createElement("div");
      content.className = "mem-content";
      const title = document.createElement("div");
      title.className = "mem-title";
      title.textContent = `${item.favorite ? "★ " : ""}${item.title}`;
      const text = document.createElement("div");
      text.className = "mem-text";
      text.textContent = item.body;
      content.append(title, text);
      const actions = document.createElement("div");
      actions.className = "mem-actions";
      actions.append(
        button("Usar no chat", "", () => usePrompt(item)),
        button(item.favorite ? "Desfavoritar" : "Favorito", "", async () => {
          await apiPost(`/api/user-library/prompts/${item.id}/favorite`, {});
          loadPrompts();
        }),
        button("Editar", "", () => {
          editingPromptId = item.id;
          $("promptTitle").value = item.title;
          $("promptBody").value = item.body;
        }),
        button("Apagar", "del", async () => {
          const ok = await openModal({ title: "Apagar prompt", body: "Apagar este prompt?", okText: "Apagar" });
          if (!ok) return;
          await apiDelete(`/api/user-library/prompts/${item.id}`);
          loadPrompts();
        }),
      );
      row.append(content, actions);
      list.append(row);
    }
  }

  async function loadPrompts() {
    const q = $("promptSearch")?.value.trim() || "";
    const data = await apiGet(`/api/user-library/prompts${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(() => null);
    if (data?.error) return;
    renderPrompts(data?.prompts || []);
  }

  async function usePrompt(item) {
    const values = {};
    for (const key of templateVars(item.body)) {
      const value = await openModal({
        title: `{{${key}}}`,
        body: "Valor para colocar no prompt.",
        mode: "prompt",
        okText: "Usar",
      });
      if (value == null) return;
      values[key] = value;
    }
    const applied = applyPromptTemplate(item.body, values);
    const input = $("promptInput");
    if (!input) return;
    input.value = applied.text;
    input.focus();
    closeMenus();
  }

  async function savePrompt() {
    const title = $("promptTitle")?.value || "";
    const body = $("promptBody")?.value || "";
    const saved = editingPromptId
      ? await apiPut(`/api/user-library/prompts/${editingPromptId}`, { title, body })
      : await apiPost("/api/user-library/prompts", { title, body });
    if (saved?.error) return tell("Prompt", fail(saved, "Não foi possível salvar."));
    await warnRedaction(saved);
    editingPromptId = "";
    $("promptTitle").value = "";
    $("promptBody").value = "";
    loadPrompts();
  }

  function renderSnippets(items) {
    const list = $("snippetList");
    if (!list) return;
    list.replaceChildren();
    if (!items?.length) {
      list.append(emptyNote("Nenhum código salvo. Use Salvar código num bloco da conversa."));
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "memory-item";
      const content = document.createElement("div");
      content.className = "mem-content";
      const title = document.createElement("div");
      title.className = "mem-title";
      title.textContent = `${item.title}${item.language ? ` · ${item.language}` : ""}`;
      const text = document.createElement("div");
      text.className = "mem-text";
      text.textContent = item.code;
      const tags = document.createElement("div");
      tags.className = "mem-text";
      tags.textContent = (item.tags || []).join(", ");
      content.append(title, text, tags);
      const actions = document.createElement("div");
      actions.className = "mem-actions";
      actions.append(
        button("Copiar", "", async () => {
          try {
            await navigator.clipboard.writeText(item.code);
          } catch {
            await tell("Copiar", "O navegador bloqueou a área de transferência.");
          }
        }),
        button("Apagar", "del", async () => {
          const ok = await openModal({ title: "Apagar código", body: "Apagar este trecho? Ele não está em execução.", okText: "Apagar" });
          if (!ok) return;
          await apiDelete(`/api/user-library/snippets/${item.id}`);
          loadSnippets();
        }),
      );
      row.append(content, actions);
      list.append(row);
    }
  }

  async function loadSnippets() {
    const q = $("snippetSearch")?.value.trim() || "";
    const data = await apiGet(`/api/user-library/snippets${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(() => null);
    if (data?.error) return;
    renderSnippets(data?.snippets || []);
  }

  async function loadProfile() {
    const data = await apiGet("/api/user-library/profile").catch(() => null);
    if (!data?.profile) return;
    $("profileName").value = data.profile.name || "";
    $("profileAddress").value = data.profile.addressAs || "";
    $("profilePreferences").value = data.profile.preferences || "";
    $("profileProjects").value = data.profile.projects || "";
    $("profileNotes").value = data.profile.notes || "";
  }

  async function saveProfile() {
    const saved = await apiPut("/api/user-library/profile", {
      name: $("profileName").value,
      addressAs: $("profileAddress").value,
      preferences: $("profilePreferences").value,
      projects: $("profileProjects").value,
      notes: $("profileNotes").value,
    });
    if (saved?.error) return tell("Sobre mim", saved.error);
    await warnRedaction(saved);
    await tell("Sobre mim", "Perfil salvo neste PC.");
  }

  function renderPersonas() {
    const list = $("personaList");
    if (!list) return;
    list.replaceChildren();
    for (const item of personas) {
      const row = document.createElement("article");
      row.className = "memory-item";
      const content = document.createElement("div");
      content.className = "mem-content";
      const title = document.createElement("div");
      title.className = "mem-title";
      title.textContent = item.builtinKey ? `${item.name} · exemplo` : item.name;
      const text = document.createElement("div");
      text.className = "mem-text";
      text.textContent = item.suggestedProfile ? `Modelo sugerido: ${item.suggestedProfile}` : "Usa o modelo atual";
      content.append(title, text);
      const actions = document.createElement("div");
      actions.className = "mem-actions";
      actions.append(
        button("Editar", "", () => {
          editingPersonaId = item.id;
          $("personaName").value = item.name;
          $("personaBody").value = item.body;
          fillSuggestedProfiles(item.suggestedProfile || "");
          mostrarEdicaoPersona(item.name);
          $("personaBody").focus();
          $("personaBody").scrollIntoView({ block: "nearest" });
        }),
        button("Duplicar", "", async () => {
          const saved = await apiPost(`/api/user-library/personas/${item.id}/duplicate`, {});
          if (saved?.error) return tell("Persona", saved.error);
          await refreshPersonaSelect(getState().conversaId || "");
          renderPersonas();
        }),
        button("Apagar", "del", async () => {
          const ok = await openModal({ title: "Apagar persona", body: "Apagar esta persona? Um exemplo pode ser restaurado.", okText: "Apagar" });
          if (!ok) return;
          await apiDelete(`/api/user-library/personas/${item.id}`);
          await refreshPersonaSelect(getState().conversaId || "");
          renderPersonas();
        }),
      );
      row.append(content, actions);
      list.append(row);
    }
  }

  // Mostra qual persona está sendo editada e o botão de cancelar; sem nome, volta ao modo "nova".
  function mostrarEdicaoPersona(nome = "") {
    const aviso = $("personaEditing");
    const cancelar = $("personaCancel");
    if (aviso) {
      aviso.hidden = !nome;
      aviso.textContent = nome ? `Editando: ${nome}` : "";
    }
    if (cancelar) cancelar.hidden = !nome;
    atualizarContadorPersona();
  }

  function atualizarContadorPersona() {
    const contador = $("personaBodyCount");
    const corpo = $("personaBody");
    if (contador && corpo) contador.textContent = `${corpo.value.length} caracteres`;
  }

  function limparFormPersona() {
    editingPersonaId = "";
    $("personaName").value = "";
    $("personaBody").value = "";
    $("personaProfile").value = "";
    mostrarEdicaoPersona("");
  }

  async function savePersona() {
    const payload = {
      name: $("personaName").value,
      body: $("personaBody").value,
      suggestedProfile: $("personaProfile").value,
    };
    const saved = editingPersonaId
      ? await apiPut(`/api/user-library/personas/${editingPersonaId}`, payload)
      : await apiPost("/api/user-library/personas", payload);
    if (saved?.error) return tell("Persona", saved.error);
    await warnRedaction(saved);
    limparFormPersona();
    await refreshPersonaSelect(getState().conversaId || "");
    renderPersonas();
  }

  async function exportLibrary() {
    const data = await apiGet("/api/user-library/export");
    if (data?.error) return tell("Exportar", data.error);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mestre-biblioteca.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importLibrary(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return tell("Importar", "Esse arquivo não é um JSON válido.");
    }
    const saved = await apiPost("/api/user-library/import", data);
    if (saved?.error) return tell("Importar", saved.error);
    await warnRedaction(saved);
    await refreshPersonaSelect(getState().conversaId || "");
    loadMemories();
    loadPrompts();
    loadSnippets();
    loadProfile();
    renderPersonas();
  }

  function schedule(fn) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fn, 180);
  }

  function openPanel(id, loader) {
    const panel = $(id);
    if (!panel) return;
    const wasOpen = panel.classList.contains("show");
    closeMenus();
    if (!wasOpen) {
      panel.classList.add("show");
      loader();
    }
  }

  function showTab(name) {
    for (const tab of document.querySelectorAll(".lib-tab")) {
      tab.classList.toggle("on", tab.dataset.tab === name);
    }
    $("libTabPrompts").hidden = name !== "prompts";
    $("libTabSnippets").hidden = name !== "snippets";
    $("libTabProfile").hidden = name !== "profile";
    $("libTabPersonas").hidden = name !== "personas";
    if (name === "prompts") loadPrompts();
    if (name === "snippets") loadSnippets();
    if (name === "profile") loadProfile();
    if (name === "personas") {
      fillSuggestedProfiles();
      refreshPersonaSelect(getState().conversaId || "").then(renderPersonas);
    }
  }

  function bind(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  }

  bind("personaSelect", "change", () => onPersonaPicked());
  bind("btnLearningNav", "click", (event) => {
    event.stopPropagation();
    openPanel("learningPanel", () => {
      loadMemories();
      loadAudit();
      apiGet("/api/user-library/settings").then((data) => {
        if ($("autoLearnToggle") && data?.settings) $("autoLearnToggle").checked = !!data.settings.autoLearn;
      }).catch(() => {});
    });
  });
  bind("btnBibliotecaNav", "click", (event) => {
    event.stopPropagation();
    openPanel("bibliotecaPanel", () => showTab("prompts"));
  });
  bind("itemLearning", "click", () => $("btnLearningNav")?.click());
  bind("itemBiblioteca", "click", () => $("btnBibliotecaNav")?.click());
  bind("autoLearnToggle", "change", () => {
    apiPut("/api/user-library/settings", { autoLearn: $("autoLearnToggle").checked });
  });
  bind("learningSearch", "input", () => schedule(loadMemories));
  bind("learningType", "change", () => loadMemories());
  bind("learningExport", "click", () => exportLibrary());
  bind("learningImport", "click", () => $("learningImportFile")?.click());
  bind("learningImportFile", "change", (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) importLibrary(file);
  });
  bind("promptSave", "click", () => savePrompt());
  bind("promptSearch", "input", () => schedule(loadPrompts));
  bind("snippetSearch", "input", () => schedule(loadSnippets));
  bind("profileSave", "click", () => saveProfile());
  bind("personaSave", "click", () => savePersona());
  bind("personaCancel", "click", () => limparFormPersona());
  bind("personaBody", "input", () => atualizarContadorPersona());
  bind("personaRestore", "click", async () => {
    const ok = await openModal({
      title: "Restaurar exemplos",
      body: "Isso devolve Assistente geral, Programador, Suporte do PC e Revisor de segurança ao texto original. Personas criadas por você ficam.",
      okText: "Restaurar",
    });
    if (!ok) return;
    await apiPost("/api/user-library/personas/restore", {});
    await refreshPersonaSelect(getState().conversaId || "");
    renderPersonas();
  });
  bind("personaMakeDefault", "click", async () => {
    const personaId = $("personaSelect")?.value;
    if (!personaId) return;
    const saved = await apiPut("/api/user-library/active-persona", { personaId, scope: "default" });
    if (saved?.error) return tell("Persona", saved.error);
    pendingPersonaId = "";
    await refreshPersonaSelect(getState().conversaId || "");
  });
  bind("personaUseDefault", "click", async () => {
    const conversationId = getState().conversaId;
    if (!conversationId) {
      pendingPersonaId = "";
      await refreshPersonaSelect("");
      return;
    }
    await apiPut("/api/user-library/active-persona", {
      personaId: $("personaSelect")?.value,
      scope: "clear-conversation",
      conversationId,
    });
    await refreshPersonaSelect(conversationId);
  });
  bind("bibliotecaExport", "click", () => exportLibrary());
  bind("bibliotecaImport", "click", () => $("bibliotecaImportFile")?.click());
  bind("bibliotecaImportFile", "change", (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) importLibrary(file);
  });
  for (const tab of document.querySelectorAll(".lib-tab")) {
    tab.addEventListener("click", (event) => {
      event.stopPropagation();
      showTab(tab.dataset.tab);
    });
  }
  for (const id of ["learningPanel", "bibliotecaPanel"]) {
    $(id)?.addEventListener("click", (event) => event.stopPropagation());
  }

  apiGet("/api/user-library/settings").then((data) => {
    if ($("autoLearnToggle") && data?.settings) $("autoLearnToggle").checked = !!data.settings.autoLearn;
  }).catch(() => {});
  refreshPersonaSelect(getState().conversaId || "");

  function decorate(body, text, role) {
    if (!body || body.dataset.libraryReady === "1") return;
    body.dataset.libraryReady = "1";
    body._libraryText = String(text || "");
    body.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-save")) return;
      const save = document.createElement("button");
      save.type = "button";
      save.className = "code-save";
      save.textContent = "Salvar código";
      save.addEventListener("click", async (event) => {
        event.stopPropagation();
        const code = pre.querySelector("code")?.textContent || "";
        const language = pre.dataset.lang && pre.dataset.lang !== "texto" ? pre.dataset.lang : "";
        const title = await openModal({
          title: "Salvar código",
          body: "Título do trecho. Ele fica na biblioteca e não é executado.",
          mode: "prompt",
          value: language || "Código",
          okText: "Continuar",
        });
        if (title == null || !String(title).trim()) return;
        const tagsRaw = await openModal({
          title: "Tags",
          body: "Tags separadas por vírgula. Pode deixar em branco.",
          mode: "prompt",
          okText: "Salvar",
        });
        if (tagsRaw == null) return;
        const saved = await apiPost("/api/user-library/snippets", {
          title,
          language,
          code,
          tags: String(tagsRaw).split(",").map((tag) => tag.trim()).filter(Boolean),
          conversationId: getState().conversaId || "",
        });
        if (saved?.error) return tell("Código", saved.error);
        await warnRedaction(saved);
        await tell("Código salvo", "O trecho ficou na Biblioteca. Nada foi executado.");
      });
      const bar = pre.querySelector(".code-bar");
      const copy = bar?.querySelector(".code-copy");
      if (bar && copy) {
        const actions = document.createElement("span");
        actions.className = "code-actions";
        copy.replaceWith(actions);
        actions.append(copy, save);
      } else {
        pre.append(save);
      }
    });
    if (body.querySelector(".msg-library-actions")) return;
    const actions = document.createElement("div");
    actions.className = "msg-library-actions";
    actions.append(button("Salvar como decisão", "msg-library-btn", async () => {
      const why = await openModal({
        title: "Salvar como decisão",
        body: "Por que essa decisão importa? Pode deixar em branco.",
        mode: "prompt",
        useTextarea: true,
        okText: "Salvar",
      });
      if (why == null) return;
      const saved = await apiPost("/api/user-library/memories/decision", {
        text: body._libraryText,
        why,
        conversationId: getState().conversaId || "",
        model: getState().modeloAtivo || "",
      });
      if (saved?.error) return tell("Decisão", saved.error);
      await warnRedaction(saved);
      await tell("Decisão salva", "Ela entra na memória como decisão, com a data de hoje.");
    }));
    if (role === "ai") {
      actions.append(button("Aprender disto", "msg-library-btn", async () => {
        let userText = "";
        let row = body.closest(".msg-row")?.previousElementSibling;
        while (row) {
          if (row.classList.contains("user")) {
            userText = row.querySelector(".msg-body")?._libraryText || "";
            break;
          }
          row = row.previousElementSibling;
        }
        const saved = await apiPost("/api/user-library/learn", {
          userText,
          assistantText: body._libraryText,
          model: getState().modeloAtivo || "",
          conversationId: getState().conversaId || "",
        });
        if (saved?.error) return tell("Aprendizado", saved.error);
        if (saved?.skipped) {
          const reason = saved.reason === "modelo não local"
            ? "O modelo desta resposta não é local. O aprendizado não usa modelo pago."
            : "Não deu para extrair agora. O Ollama local precisa estar no ar.";
          return tell("Aprendizado", reason);
        }
        await warnRedaction(saved);
        const count = saved.created?.length || 0;
        await tell("Aprendizado", count ? `${count} memória(s) nova(s).` : "Nada novo para guardar.");
      }));
    }
    body.append(actions);
  }

  function showTurnMeta(body, info) {
    if (!body || !info || body.querySelector(".learning-meta")) return;
    const meta = document.createElement("div");
    meta.className = "msg-meta learning-meta";
    const memories = (info.memories || []).map((item) => `${item.type}: ${String(item.text || "").slice(0, 80)}`);
    meta.textContent = `Modelo: ${info.model || "—"} · Persona: ${info.personaName || "—"} · Memórias: ${memories.length ? memories.join(" · ") : "nenhuma"}`;
    body.append(meta);
  }

  async function prepare(input) {
    const data = await apiPost("/api/user-library/prepare", {
      query: input.query || "",
      conversationId: input.conversationId || "",
      includePersonal: input.includePersonal !== false,
    });
    if (data?.error) return null;
    return data;
  }

  function afterTurn(input) {
    return apiPost("/api/user-library/after-turn", input);
  }

  return { prepare, decorate, showTurnMeta, onConversation, afterTurn };
}
