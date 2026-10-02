/**
 * Turns what the user typed in "URL do sistema" into the HTTP(S) address of the ADT services:
 * a full URL is used as is (scheme, host and port), a bare server ("10.10.98.24", "sap-qas:44300")
 * is probed on the usual SAP ports.
 */
import http from "node:http";
import https from "node:https";
import { BackendError } from "./types.js";

/** ICM ports for instance 00 and 01 first (443NN / 80NN), then the standard web ports. */
const DEFAULT_PORTS: [scheme: "https" | "http", port: number][] = [
  ["https", 44300],
  ["http", 8000],
  ["https", 443],
  ["http", 80],
  ["https", 44301],
  ["http", 8001],
];

export function candidatesFor(input: string): string[] | null {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      return [new URL(text).origin];
    } catch {
      return null;
    }
  }
  const m = text.match(/^([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?(?:\/.*)?$/i);
  if (!m) return null;
  const [, host, port] = m;
  if (port) return [`https://${host}:${port}`, `http://${host}:${port}`];
  return DEFAULT_PORTS.map(([scheme, p]) => `${scheme}://${host}:${p}`);
}

type Probe = { url: string; status?: number; location?: string };

/** Asks a candidate for the ADT discovery document; any HTTP answer means a server listens there. */
function probe(url: string, timeoutMs: number): Promise<Probe> {
  return new Promise((resolve) => {
    const target = new URL("/sap/bc/adt/discovery", url);
    const lib = target.protocol === "https:" ? https : http;
    // Only checks where the system answers; the logon itself applies the user's certificate choice.
    const req = lib.request(target, { method: "GET", timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      res.resume();
      const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
      resolve({ url, status: res.statusCode, location });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ url }));
    req.end();
  });
}

export async function resolveSystemUrl(input: string, timeoutMs = 4000): Promise<string> {
  const candidates = candidatesFor(input);
  if (!candidates) throw new BackendError("URL inválido: indica o servidor, ex. 10.10.98.24 ou https://servidor:44300", 400, "badRequest");
  if (candidates.length === 1) return candidates[0];

  const results = await Promise.all(candidates.map((c) => probe(c, timeoutMs)));
  // ADT answers its discovery with 200, or 401/403 before logon.
  const adt = results.find((r) => r.status === 200 || r.status === 401 || r.status === 403);
  if (adt) return adt.url;
  // A redirect: to another address (often HTTP → HTTPS on another port), or to a logon page of
  // the same server, which still accepts the logon ADT sends.
  const redirect = results.find((r) => r.status !== undefined && r.status >= 300 && r.status < 400);
  if (redirect) {
    const target = redirect.location ? new URL(redirect.location, redirect.url).origin : redirect.url;
    if (target === redirect.url) return redirect.url;
    const followed = await probe(target, timeoutMs);
    if (followed.status !== undefined && followed.status < 500) return target;
    throw new BackendError(
      `${redirect.url} redireciona para ${target}, que não respondeu. Indica o URL completo (ex. ${target}) e, se for HTTPS, marca «Aceitar certificados autoassinados».`,
      502,
      "network",
    );
  }
  const web = results.find((r) => r.status !== undefined);
  if (web) {
    throw new BackendError(
      `O servidor responde em ${web.url}, mas o serviço ADT (/sap/bc/adt) não respondeu (HTTP ${web.status}). Confirma na SICF que está ativo, ou indica o URL completo.`,
      502,
      "adtInactive",
    );
  }
  const host = new URL(candidates[0]).hostname;
  const tried = [...new Set(candidates.map((c) => new URL(c).port))].join(", ");
  throw new BackendError(
    `Não encontrei o SAP em ${host} (portas ${tried}). Confirma que estás na rede/VPN ou indica o URL completo, ex. https://${host}:44300 (a porta está na SMICM → Serviços).`,
    502,
    "network",
  );
}
