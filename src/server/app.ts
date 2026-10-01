import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { ApiErrorBody, ConnectionInput, SaveRequest } from "../shared/types.js";
import { AdtBackend } from "./backend/adt.js";
import { DemoBackend } from "./backend/demo.js";
import { BackendError, type AbapBackend } from "./backend/types.js";

const COOKIE = "alva_sid";
/** Header every API call must carry: a cross-site form or image cannot set it (simple CSRF guard). */
export const CLIENT_HEADER = "x-alva";

interface Session {
  backend: AbapBackend;
  lastUsed: number;
}

export interface AppOptions {
  /** Folder with the built client, served when present. */
  clientDir?: string;
  /** Sessions idle for longer than this are closed (default 8 hours). */
  idleTimeoutMs?: number;
  /** Replaces the real ADT connection (tests). */
  connect?: (input: ConnectionInput) => Promise<AbapBackend>;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function str(value: unknown, field: string, { optional = false, allowEmpty = false } = {}): string {
  if (value === undefined || value === null) {
    if (optional) return "";
    throw new BackendError(`Campo em falta: ${field}`, 400, "badRequest");
  }
  if (typeof value !== "string") throw new BackendError(`Campo inválido: ${field}`, 400, "badRequest");
  if (!allowEmpty && !optional && !value.trim()) throw new BackendError(`Campo vazio: ${field}`, 400, "badRequest");
  return value;
}

function int(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new BackendError(`Campo inválido: ${field}`, 400, "badRequest");
  return value;
}

type Handler = (req: Request, res: Response, backend: AbapBackend) => Promise<unknown>;

export function createApp(options: AppOptions = {}) {
  const sessions = new Map<string, Session>();
  const idleTimeout = options.idleTimeoutMs ?? 8 * 60 * 60 * 1000;
  const connect = options.connect ?? ((input: ConnectionInput) => AdtBackend.connect(input));

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastUsed > idleTimeout) {
        sessions.delete(id);
        void s.backend.close();
      }
    }
  }, 60_000);
  sweep.unref();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers[CLIENT_HEADER] !== "1") {
      res.status(403).json({ error: "Pedido recusado", code: "forbidden" } satisfies ApiErrorBody);
      return;
    }
    next();
  });

  function currentSession(req: Request): Session | undefined {
    const id = readCookie(req, COOKIE);
    const session = id ? sessions.get(id) : undefined;
    if (session) session.lastUsed = Date.now();
    return session;
  }

  /** Wraps a handler that needs a logged-on backend. */
  const withBackend =
    (handler: Handler) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const session = currentSession(req);
        if (!session) throw new BackendError("Sem sessão: liga-te a um sistema", 401, "unauthorized");
        const result = await handler(req, res, session.backend);
        if (!res.headersSent) res.json(result ?? { ok: true });
      } catch (e) {
        next(e);
      }
    };

  app.post("/api/session", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      let backend: AbapBackend;
      if (body.demo === true) {
        backend = new DemoBackend();
      } else {
        const url = str(body.url, "url").trim();
        if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new BackendError("URL inválido: usa http(s)://servidor:porta", 400, "badRequest");
        backend = await connect({
          url,
          user: str(body.user, "user"),
          password: str(body.password, "password", { allowEmpty: true }),
          client: str(body.client, "client", { optional: true }),
          language: str(body.language, "language", { optional: true }),
          allowSelfSigned: body.allowSelfSigned === true,
        });
      }
      const previous = readCookie(req, COOKIE);
      if (previous && sessions.has(previous)) {
        void sessions.get(previous)!.backend.close();
        sessions.delete(previous);
      }
      const id = randomBytes(24).toString("base64url");
      sessions.set(id, { backend, lastUsed: Date.now() });
      res.cookie(COOKIE, id, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
      res.json(backend.info);
    } catch (e) {
      next(e);
    }
  });

  // No session is a normal state for this call (the logon screen asks it on start).
  app.get("/api/session", (req, res) => {
    res.json(currentSession(req)?.backend.info ?? null);
  });

  app.delete("/api/session", async (req, res) => {
    const id = readCookie(req, COOKIE);
    const session = id ? sessions.get(id) : undefined;
    if (id && session) {
      sessions.delete(id);
      await session.backend.close();
    }
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get(
    "/api/search",
    withBackend(async (req, _res, b) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const type = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
      const max = Math.min(200, Math.max(1, Number(req.query.max) || 50));
      return b.search(q, type, max);
    }),
  );

  app.get(
    "/api/packages/:name",
    withBackend(async (req, _res, b) => b.packageContents(String(req.params.name))),
  );

  app.get(
    "/api/object",
    withBackend(async (req, _res, b) => {
      const uri = str(req.query.uri, "uri");
      if (!uri.startsWith("/sap/bc/adt/")) throw new BackendError("URI de objeto inválido", 400, "badRequest");
      const version = req.query.version === "active" || req.query.version === "inactive" ? req.query.version : undefined;
      return b.open(uri, version);
    }),
  );

  app.post(
    "/api/object/save",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      const request: SaveRequest = {
        objectUri: str(body.objectUri, "objectUri"),
        sourceUri: str(body.sourceUri, "sourceUri"),
        source: str(body.source, "source", { allowEmpty: true }),
        transport: str(body.transport, "transport", { optional: true }).trim().toUpperCase() || undefined,
        etag: str(body.etag, "etag", { optional: true }) || undefined,
        force: body.force === true,
      };
      return b.save(request);
    }),
  );

  app.post(
    "/api/object/check",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      return b.syntaxCheck(str(body.objectUri, "objectUri"), str(body.sourceUri, "sourceUri"), str(body.source, "source", { allowEmpty: true }));
    }),
  );

  app.post(
    "/api/object/completion",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      return b.completion(str(body.sourceUri, "sourceUri"), str(body.source, "source", { allowEmpty: true }), int(body.line, "line"), int(body.column, "column"));
    }),
  );

  app.post(
    "/api/object/definition",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      const target = await b.definition(
        str(body.sourceUri, "sourceUri"),
        str(body.source, "source", { allowEmpty: true }),
        int(body.line, "line"),
        int(body.startColumn, "startColumn"),
        int(body.endColumn, "endColumn"),
      );
      return { target };
    }),
  );

  app.post(
    "/api/object/activate",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      return b.activate(str(body.name, "name"), str(body.objectUri, "objectUri"));
    }),
  );

  app.post(
    "/api/prettyprint",
    withBackend(async (req, _res, b) => ({ source: await b.prettyPrint(str((req.body ?? {}).source, "source", { allowEmpty: true })) })),
  );

  app.post(
    "/api/objects",
    withBackend(async (req, _res, b) => {
      const body = req.body ?? {};
      if (!["PROG/P", "CLAS/OC", "INTF/OI"].includes(body.type)) throw new BackendError("Tipo de objeto não suportado", 400, "badRequest");
      return b.create({
        type: body.type,
        name: str(body.name, "name"),
        description: str(body.description, "description"),
        packageName: str(body.packageName, "packageName"),
        transport: str(body.transport, "transport", { optional: true }).trim().toUpperCase() || undefined,
      });
    }),
  );

  app.post(
    "/api/object/run",
    withBackend(async (req, _res, b) => ({ output: await b.runClass(str((req.body ?? {}).name, "name")) })),
  );

  app.post(
    "/api/object/unittests",
    withBackend(async (req, _res, b) => b.unitTests(str((req.body ?? {}).objectUri, "objectUri"))),
  );

  app.get(
    "/api/inactive",
    withBackend(async (_req, _res, b) => b.inactiveObjects()),
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Não encontrado", code: "notFound" } satisfies ApiErrorBody);
  });

  if (options.clientDir && existsSync(options.clientDir)) {
    const clientDir = options.clientDir;
    // Hashed bundles never change; index.html is always revalidated.
    app.use("/assets", express.static(path.join(clientDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get(/.*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BackendError) {
      res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiErrorBody);
      return;
    }
    // Body parser errors (malformed JSON, body too large) carry their own 4xx status.
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: unknown }).status) : NaN;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: status === 413 ? "Pedido demasiado grande" : "Pedido inválido", code: "badRequest" } satisfies ApiErrorBody);
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno", code: "internal" } satisfies ApiErrorBody);
  });

  return {
    app,
    close: async () => {
      clearInterval(sweep);
      await Promise.all([...sessions.values()].map((s) => s.backend.close()));
      sessions.clear();
    },
  };
}
