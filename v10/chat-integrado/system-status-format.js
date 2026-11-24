// Formata as métricas do /status do launcher em campos pt-BR rotulados.
// "cpu" no bruto é o USO médio da CPU em % (LoadPercentage), não a contagem
// de núcleos: aqui vira uso_cpu_pct, e a contagem vem de cpuCount.

const round = (n, d = 2) => Math.round(Number(n) * 10 ** d) / 10 ** d;
const br = (n) => String(round(n)).replace(".", ",");

export function formatUptimePtBr(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ""}${h}h ${String(m).padStart(2, "0")}min`;
}

export function formatSystemStatusPtBr(raw = {}) {
  const bruto = { ...raw };
  const disponivel = Number(raw.ramTotal) > 0 || Number(raw.uptimeSec) > 0;
  if (!disponivel) {
    return {
      disponivel: false,
      processadores_logicos: null,
      uso_cpu_pct: null,
      ram_total_gb: null,
      ram_livre_gb: null,
      disco_livre_gb: null,
      disco_total_gb: null,
      tempo_ligado: null,
      resumo: "Não foi possível coletar as métricas agora (o PowerShell do Mestre não respondeu). Tente de novo em alguns segundos.",
      bruto,
    };
  }
  const ramTotal = round(raw.ramTotal);
  const ramLivre = round(raw.ramFree);
  const discoLivre = round(raw.diskFree);
  const discoUsado = round(raw.diskUsed);
  const discoTotal = round(discoLivre + discoUsado, 1);
  const nucleos = Number.isFinite(Number(raw.cpuCount)) && Number(raw.cpuCount) > 0 ? Number(raw.cpuCount) : null;
  const usoCpu = round(raw.cpu, 1);
  const tempo = formatUptimePtBr(raw.uptimeSec);
  return {
    disponivel: true,
    processadores_logicos: nucleos,
    uso_cpu_pct: usoCpu,
    ram_total_gb: ramTotal,
    ram_livre_gb: ramLivre,
    ram_usada_gb: round(ramTotal - ramLivre),
    ram_uso_pct: ramTotal > 0 ? round(((ramTotal - ramLivre) / ramTotal) * 100, 1) : null,
    disco_livre_gb: discoLivre,
    disco_usado_gb: discoUsado,
    disco_total_gb: discoTotal,
    tempo_ligado: tempo,
    tempo_ligado_seg: Math.floor(Number(raw.uptimeSec) || 0),
    resumo: `CPU ${br(usoCpu)}% de uso${nucleos ? ` em ${nucleos} processadores lógicos` : ""}; RAM ${br(ramLivre)} GB livres de ${br(ramTotal)} GB; disco C: ${br(discoLivre)} GB livres de ${br(discoTotal)} GB; ligado há ${tempo}.`,
    bruto,
  };
}
