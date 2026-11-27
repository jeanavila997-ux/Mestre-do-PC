import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_SUFFIXES = [
  "discord.com",
  "discordapp.com",
  "hooks.slack.com",
  "webhook.office.com",
  "logic.azure.com",
];

export function isPrivateAddress(ip) {
  const value = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!value) return true;
  if (value === "::1" || value === "0.0.0.0" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function validateWebhookUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); }
  catch { return { ok: false, reason: "URL de webhook inválida." }; }
  if (url.protocol !== "https:") return { ok: false, reason: "Webhook precisa ser HTTPS." };
  if (url.username || url.password) return { ok: false, reason: "URL de webhook não pode trazer usuário ou senha." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "Destino interno bloqueado." };
  }
  if (isIP(host)) return { ok: false, reason: "Webhook por endereço IP não é aceito." };
  const allowed = ALLOWED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) return { ok: false, reason: "Host de webhook não permitido." };
  return { ok: true, href: url.href, host };
}

export async function assertPublicWebhookUrl(raw, lookupFn = lookup) {
  const parsed = validateWebhookUrl(raw);
  if (!parsed.ok) return parsed;
  let records;
  try {
    records = await lookupFn(parsed.host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "Não foi possível resolver o host do webhook." };
  }
  if (!records?.length) return { ok: false, reason: "Host do webhook sem endereço." };
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      return { ok: false, reason: "O host do webhook aponta para um endereço interno." };
    }
  }
  return parsed;
}
