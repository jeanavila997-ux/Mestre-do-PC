export async function authorizeKokoroOnce(options = {}) {
  const storage = options.storage || globalThis.localStorage;
  const key = "mestre.kokoroDownloadApproved";
  try { if (storage.getItem(key) === "1") return true; } catch { /* segue para confirmação */ }
  if (typeof options.confirm !== "function") return false;
  const approved = await options.confirm();
  if (!approved) return false;
  try { storage.setItem(key, "1"); } catch { /* consentimento vale só para esta vez */ }
  return true;
}

export async function playKokoro(text, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl("/api/voice/kokoro", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mestre-Client": "v10-web" },
    body: JSON.stringify({ text: String(text || "") }),
  });
  if (!response.ok) throw new Error(`Kokoro/Voicebox retornou HTTP ${response.status}.`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Kokoro retornou áudio vazio.");
  const createObjectURL = options.createObjectURL || URL.createObjectURL.bind(URL);
  const createAudio = options.createAudio || ((url) => new Audio(url));
  const url = createObjectURL(blob);
  const audio = createAudio(url);
  await audio.play();
  return { audio, url, revoke: () => (options.revokeObjectURL || URL.revokeObjectURL.bind(URL))(url) };
}

export function attachKokoroButton(container, text, options = {}) {
  if (!container || !String(text || "").trim() || container.querySelector(".kokoro-play")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sync-badge kokoro-play";
  button.textContent = "🔊 Kokoro";
  button.title = "Ouvir esta resposta com Kokoro (Voicebox local)";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "⏳ Kokoro...";
    try {
      const approved = await authorizeKokoroOnce({
        storage: globalThis.localStorage,
        confirm: () => {
          const modal = options.confirm || globalThis.openModal;
          if (typeof modal !== "function") return Promise.resolve(false);
          return modal({
            title: "Ativar Kokoro",
            body: "A primeira síntese pode baixar o modelo Kokoro (~350 MB) no Voicebox local. Autoriza o download se necessário e a reprodução desta resposta?",
            okText: "Autorizar e ouvir",
          });
        },
      });
      if (!approved) {
        button.disabled = false;
        button.textContent = "🔊 Kokoro";
        return;
      }
      const playback = await playKokoro(text);
      button.textContent = "▶ Kokoro tocando";
      playback.audio.addEventListener("ended", () => {
        playback.revoke();
        button.disabled = false;
        button.textContent = "🔊 Kokoro";
      }, { once: true });
    } catch (error) {
      button.disabled = false;
      button.textContent = "🔊 Kokoro";
      const notify = options.notify || globalThis.showToast;
      if (typeof notify === "function") notify(`Kokoro indisponível: ${error.message}`);
      else console.error("Kokoro indisponível:", error.message);
    }
  });
  container.appendChild(button);
}
