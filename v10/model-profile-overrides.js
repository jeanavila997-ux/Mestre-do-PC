import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultsPath = join(projectRoot, "mcp-server", "model-profiles.json");

let defaultsCache = null;
let overridesCache = { stamp: "", path: "", data: { profiles: {} } };

export function validateModelName(name) {
  const value = String(name ?? "").trim();
  if (!value) return { ok: false, reason: "Informe o nome do modelo." };
  if (value.length > 128) return { ok: false, reason: "Nome de modelo longo demais (máximo 128)." };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/.test(value)) {
    return { ok: false, reason: "Nome de modelo contém caracteres não permitidos." };
  }
  if (value.includes("..") || value.includes("//")) {
    return { ok: false, reason: "Nome de modelo inválido." };
  }
  return { ok: true, model: value };
}

export function overridesFilePath() {
  return process.env.MESTRE_PROFILE_OVERRIDES_PATH || join(projectRoot, "data", "model-profile-overrides.json");
}

export function loadDefaultProfiles() {
  if (!defaultsCache) {
    defaultsCache = JSON.parse(readFileSync(defaultsPath, "utf8"));
  }
  return defaultsCache;
}

export function readOverrides() {
  const path = overridesFilePath();
  if (!existsSync(path)) {
    overridesCache = { stamp: "missing", path, data: { profiles: {} } };
    return overridesCache.data;
  }
  try {
    const stamp = String(statSync(path).mtimeMs);
    if (overridesCache.path === path && overridesCache.stamp === stamp) return overridesCache.data;
    const data = JSON.parse(readFileSync(path, "utf8"));
    const profiles = data && typeof data.profiles === "object" && data.profiles ? data.profiles : {};
    overridesCache = { path, stamp, data: { profiles } };
    return overridesCache.data;
  } catch {
    return { profiles: {} };
  }
}

function writeOverrides(data) {
  const path = overridesFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ profiles: data.profiles || {} }, null, 2), "utf8");
  overridesCache = { path: "", stamp: "", data: { profiles: {} } };
}

export function effectiveModel(profileId, fallback = "") {
  const saved = readOverrides().profiles?.[profileId]?.model;
  if (typeof saved === "string" && saved.trim()) return saved.trim();
  return fallback || "";
}

export function listEffectiveProfiles() {
  const defaults = loadDefaultProfiles();
  const overrides = readOverrides().profiles || {};
  return Object.entries(defaults.profiles || {}).map(([id, profile]) => {
    const defaultModel = profile.model || "";
    const model = effectiveModel(id, defaultModel);
    return {
      id,
      label: profile.label || id,
      description: profile.description || "",
      model,
      defaultModel,
      overridden: Boolean(overrides[id]?.model),
    };
  });
}

export function saveProfileOverride(profileId, model) {
  const defaults = loadDefaultProfiles();
  if (!defaults.profiles?.[profileId]) {
    return { ok: false, status: 404, reason: "Perfil não existe." };
  }
  const valid = validateModelName(model);
  if (!valid.ok) return { ok: false, status: 400, reason: valid.reason };
  const data = readOverrides();
  data.profiles[profileId] = { model: valid.model, updatedAt: new Date().toISOString() };
  writeOverrides(data);
  return { ok: true, status: 200, model: valid.model, profileId };
}

export function resetProfileOverride(profileId) {
  const defaults = loadDefaultProfiles();
  if (!defaults.profiles?.[profileId]) {
    return { ok: false, status: 404, reason: "Perfil não existe." };
  }
  const data = readOverrides();
  if (data.profiles) delete data.profiles[profileId];
  writeOverrides(data);
  const profile = defaults.profiles[profileId];
  return { ok: true, status: 200, model: profile.model || "", profileId };
}
