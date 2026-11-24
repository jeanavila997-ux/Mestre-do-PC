const DEFAULT_VOICEBOX_URL = "http://127.0.0.1:17493";
const MAX_SPEECH_CHARS = 4000;

export function prepareSpeechText(input) {
  const text = String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("Não há texto disponível para síntese de voz.");
  return text.slice(0, MAX_SPEECH_CHARS);
}

function voiceOptions(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.VOICEBOX_URL || DEFAULT_VOICEBOX_URL).replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password) {
    throw new Error("Kokoro exige Voicebox local em http://127.0.0.1; nenhum texto foi enviado.");
  }
  return {
    baseUrl,
    fetchImpl: options.fetchImpl || fetch,
    profileId: options.profileId || process.env.VOICEBOX_KOKORO_PROFILE_ID || "",
  };
}

async function voiceRequest(config, path, init = {}) {
  let response;
  try {
    response = await config.fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(init.method ? 180000 : 15000),
    });
  } catch (error) {
    throw new Error(`Não foi possível contatar o Voicebox local: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Voicebox retornou HTTP ${response.status} ao usar Kokoro.`);
  return response;
}

async function ensureProfile(config) {
  if (config.profileId) return config.profileId;
  const response = await voiceRequest(config, "/profiles");
  const payload = await response.json();
  const profiles = Array.isArray(payload) ? payload : (payload.profiles || []);
  const existing = profiles.find((profile) => {
    const engine = profile.default_engine || profile.preset_engine || profile.engine;
    return engine === "kokoro" && (!profile.language || ["pt", "pt-BR", "pt-br"].includes(profile.language));
  });
  if (existing?.id) return existing.id;
  const created = await voiceRequest(config, "/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Mestre Kokoro Dora PT",
      language: "pt",
      voice_type: "preset",
      preset_engine: "kokoro",
      preset_voice_id: "pf_dora",
      default_engine: "kokoro",
    }),
  });
  const profile = await created.json();
  const id = profile.id || profile.profile?.id;
  if (!id) throw new Error("Voicebox não retornou o ID do perfil Kokoro.");
  return id;
}

export async function generateKokoroSpeech(input, options = {}) {
  const config = voiceOptions(options);
  const text = prepareSpeechText(input);
  const profileId = await ensureProfile(config);
  const response = await voiceRequest(config, "/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId, text, language: "pt", engine: "kokoro" }),
  });
  const contentType = String(response.headers?.get?.("content-type") || "audio/wav").split(";")[0];
  if (contentType.includes("json")) throw new Error("Voicebox retornou JSON em vez de áudio Kokoro.");
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0 || audio.length > 25 * 1024 * 1024) throw new Error("Voicebox retornou áudio vazio ou acima do limite.");
  return { audio, contentType, profileId, characters: text.length };
}
