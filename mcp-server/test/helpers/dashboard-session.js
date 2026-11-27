import http from "node:http";

function rawRequest(base, path, headers) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function readDashboardSession(base) {
  const page = await rawRequest(base, "/", {
    Accept: "text/html",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  });
  const match = page.body.match(/name="mestre-session-token" content="([^"]+)"/);
  if (!match) throw new Error(`HTML sem token de sessão (HTTP ${page.status}).`);
  return match[1];
}

export async function dashboardHeaders(base, extra = {}) {
  const token = await readDashboardSession(base);
  return {
    "Content-Type": "application/json",
    "X-Mestre-Client": "v10-web",
    Origin: base,
    "X-Mestre-Session": token,
    ...extra,
  };
}
