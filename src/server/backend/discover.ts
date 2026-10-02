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
  // A redirect: to the same server on another port (often HTTP → HTTPS), or to a logon page,
  // possibly of another site (SAML single sign-on, e.g. Google). Only the first is followed: in the
  // other cases this is the SAP server, and the ADT logon (user and password) goes to it directly.
  const redirect = results.find((r) => r.status !== undefined && r.status >= 300 && r.status < 400);
  if (redirect) {
    const target = redirect.location ? new URL(redirect.location, redirect.url).origin : redirect.url;
    if (target === redirect.url || new URL(target).hostname !== new URL(redirect.url).hostname) return redirect.url;
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

export interface DiagnosisInput {
  url: string;
  user: string;
  password: string;
  client?: string;
  language?: string;
}

/**
 * When the logon fails for a reason other than the password: asks the main ADT addresses with the
 * user's credentials and reports what each answered, so the cause can be seen (and sent to support).
 */
export async function diagnoseLogon(input: DiagnosisInput, timeoutMs = 6000): Promise<string[]> {
  const paths = ["/sap/bc/adt/discovery", "/sap/bc/adt/core/discovery", "/sap/bc/adt/compatibility/graph"];
  const auth = `Basic ${Buffer.from(`${input.user}:${input.password}`).toString("base64")}`;
  const lines = await Promise.all(
    paths.map(
      (path) =>
        new Promise<string>((resolve) => {
          const target = new URL(path, input.url);
          if (input.client) target.searchParams.set("sap-client", input.client);
          if (input.language) target.searchParams.set("sap-language", input.language);
          const lib = target.protocol === "https:" ? https : http;
          const req = lib.request(target, { method: "GET", timeout: timeoutMs, rejectUnauthorized: false, headers: { Authorization: auth } }, (res) => {
            res.resume();
            const location = typeof res.headers.location === "string" ? ` → ${res.headers.location}` : "";
            resolve(`${path}: HTTP ${res.statusCode}${location}`);
          });
          req.on("timeout", () => req.destroy(new Error("sem resposta")));
          req.on("error", (e) => resolve(`${path}: ${e.message}`));
          req.end();
        }),
    ),
  );
  return [`Servidor: ${input.url}`, ...lines];
}
