import {
  ADTClient,
  createSSLConfig,
  isAdtError,
  isAdtException,
  isClassStructure,
  isHttpError,
  isLoginError,
  objectPath,
  session_types,
  type UnitTestAlert as AdtUnitTestAlert,
} from "abap-adt-api";
import {
  CLASS_INCLUDE_LABELS,
  type ActivationOutcome,
  type ClassInclude,
  type CompletionItem,
  type ConnectionInput,
  type CreateOutcome,
  type CreateRequest,
  type DefinitionTarget,
  type Diagnostic,
  type ObjectRef,
  type OpenedObject,
  type SaveOutcome,
  type SaveRequest,
  type SessionInfo,
  type TreeNode,
  type UnitTestAlert,
  type UnitTestClassResult,
} from "../../shared/types.js";
import { BackendError, type AbapBackend } from "./types.js";
import { etagOf, languageOf, searchPattern, severityOf, splitSourceUri, stripFragment } from "./util.js";

/** Runs one task at a time: locks and writes share the single stateful ADT session. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Turns ADT client errors into errors the REST API can report. */
export function toBackendError(e: unknown): Error {
  if (e instanceof BackendError) return e;
  // Rejected logon (HTTP 401) or a CSRF token the system no longer accepts: the session is gone.
  if (isAdtException(e) && isLoginError(e)) return new BackendError("Sessão SAP expirada ou credenciais inválidas", 401, "unauthorized");
  if (isAdtError(e)) {
    const status = e.err === 404 ? 404 : e.err === 403 ? 403 : e.err === 409 || e.err === 423 ? 409 : 502;
    return new BackendError(e.localizedMessage || e.message, status, "sap");
  }
  if (isHttpError(e)) {
    const status = e.status;
    if (status === 404) return new BackendError("Não encontrado no sistema SAP", 404, "notFound");
    if (status === 403) return new BackendError("Sem autorização no sistema SAP", 403, "forbidden");
    if (status) return new BackendError(`O sistema SAP respondeu ${status}: ${e.message}`, 502, "sap");
    return new BackendError(`Sistema SAP inacessível: ${e.message}`, 502, "network");
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** SCC_COMPLETION role of an interface (sccmp_role_intftype): after -> it is completed as "intf~". */
const INTERFACE_ROLE = 58;

/** ".../includes/testclasses#start=34,4" → the source URI and the line. */
function locate(uri: string | undefined): { uri?: string; line?: number } {
  if (!uri) return {};
  const m = uri.match(/#start=(\d+)/);
  return { uri: splitSourceUri(uri).sourceUri ?? stripFragment(uri), line: m ? Number(m[1]) : undefined };
}

function toAlert(a: AdtUnitTestAlert): UnitTestAlert {
  // The innermost stack entry with a position is where the assertion failed.
  const at = a.stack.map((e) => locate(e["adtcore:uri"])).find((l) => l.line !== undefined);
  return {
    kind: a.kind === "failedAssertion" || a.kind === "exception" ? a.kind : "warning",
    title: a.title,
    details: a.details,
    ...at,
  };
}

export class AdtBackend implements AbapBackend {
  private readonly lockMutex = new Mutex();

  private constructor(
    /** Stateful session, used for lock → write → unlock. */
    private readonly writer: ADTClient,
    /** Stateless clone sharing the logon, used for everything that reads. */
    private readonly reader: ADTClient,
    readonly info: SessionInfo,
  ) {}

  static async connect(input: ConnectionInput): Promise<AdtBackend> {
    // Only scheme, host and port matter: a pasted SAP GUI for HTML / Fiori address works too.
    const url = new URL(input.url.trim()).origin;
    const options = url.startsWith("https:") ? createSSLConfig(!!input.allowSelfSigned) : {};
    const client = new ADTClient(url, input.user.trim(), input.password, input.client?.trim() || undefined, input.language?.trim() || undefined, {
      ...options,
      timeout: 60_000,
    });
    try {
      await client.login();
    } catch (e) {
      throw toBackendError(e);
    }
    const host = new URL(url).hostname;
    const info: SessionInfo = {
      systemId: host.split(".")[0].toUpperCase(),
      url,
      user: client.username.toUpperCase(),
      client: client.client || "",
      language: client.language || "",
      demo: false,
    };
    return new AdtBackend(client, client.statelessClone, info);
  }

  private async call<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (e) {
      throw toBackendError(e);
    }
  }

  search(query: string, type: string | undefined, max: number): Promise<ObjectRef[]> {
    return this.call(async () => {
      const pattern = searchPattern(query);
      if (!pattern) return [];
      const results = await this.reader.searchObject(pattern, type || undefined, max);
      return results.map((r) => ({
        name: r["adtcore:name"],
        type: r["adtcore:type"],
        uri: r["adtcore:uri"],
        description: r["adtcore:description"],
        packageName: r["adtcore:packageName"],
      }));
    });
  }

  packageContents(packageName: string): Promise<TreeNode[]> {
    return this.call(async () => {
      const structure = await this.reader.nodeContents("DEVC/K", packageName.toUpperCase());
      const labels = new Map(structure.objectTypes.map((t) => [t.OBJECT_TYPE, t.OBJECT_TYPE_LABEL]));
      return structure.nodes
        .filter((n) => n.OBJECT_NAME && n.OBJECT_URI)
        .map((n) => ({
          name: n.OBJECT_NAME,
          type: n.OBJECT_TYPE,
          uri: n.OBJECT_URI,
          description: n.DESCRIPTION,
          packageName: packageName.toUpperCase(),
          expandable: n.OBJECT_TYPE === "DEVC/K",
          category: labels.get(n.OBJECT_TYPE),
        }));
    });
  }

  open(uri: string, version?: "active" | "inactive"): Promise<OpenedObject> {
    return this.call(async () => {
      const { objectUri, sourceUri: explicitSource } = splitSourceUri(uri);
      const structure = await this.reader.objectStructure(objectUri);
      const meta = structure.metaData;
      const type = meta["adtcore:type"];
      if (type.startsWith("DEVC")) throw new BackendError("Os pacotes não têm código fonte", 400, "notSource");
      const sourceUri = explicitSource ?? ADTClient.mainInclude(structure);
      const source = await this.reader.getObjectSource(sourceUri, version ? { version } : undefined);
      let includes: ClassInclude[] | undefined;
      if (isClassStructure(structure)) {
        try {
          includes = [...ADTClient.classIncludes(structure)].map(([kind, uri]) => ({ kind, uri, label: CLASS_INCLUDE_LABELS[kind] ?? kind }));
        } catch {
          // An include without a text link: leave the switcher out rather than fail the open.
        }
      }
      return {
        ref: {
          name: meta["adtcore:name"],
          type,
          uri: objectUri,
          description: meta["adtcore:description"],
        },
        sourceUri,
        source,
        version: meta["adtcore:version"] === "inactive" ? "inactive" : "active",
        language: languageOf(type),
        editable: true,
        changedBy: meta["adtcore:changedBy"],
        changedAt: meta["adtcore:changedAt"] ? new Date(meta["adtcore:changedAt"]).toISOString() : undefined,
        etag: etagOf(source),
        include: includes?.find((i) => i.uri === sourceUri)?.kind,
        includes,
      };
    });
  }

  save(request: SaveRequest): Promise<SaveOutcome> {
    const { objectUri, sourceUri, source } = request;
    return this.call(() =>
      this.lockMutex.run(async () => {
        this.writer.stateful = session_types.stateful;
        const lock = await this.writer.lock(objectUri);
        try {
          if (request.etag && !request.force) {
            const current = await this.writer.getObjectSource(sourceUri);
            if (etagOf(current) !== request.etag) {
              throw new BackendError("O objeto foi alterado no sistema desde que o abriste", 409, "conflict");
            }
          }
          let transport = request.transport || lock.CORRNR || undefined;
          if (!transport && lock.IS_LOCAL !== "X") {
            const info = await this.writer.transportInfo(sourceUri);
            const locked = info.LOCKS?.HEADER?.TRKORR;
            if (locked) transport = locked;
            // Local objects ($TMP and other local packages) are not recorded.
            else if (info.DLVUNIT !== "LOCAL") {
              return {
                status: "needsTransport",
                packageName: info.DEVCLASS,
                transports: (info.TRANSPORTS ?? []).map((t) => ({ number: t.TRKORR, text: t.AS4TEXT, owner: t.AS4USER })),
              } satisfies SaveOutcome;
            }
          }
          await this.writer.setObjectSource(sourceUri, source, lock.LOCK_HANDLE, transport);
          return { status: "saved", etag: etagOf(source), transport } satisfies SaveOutcome;
        } finally {
          await this.writer.unLock(objectUri, lock.LOCK_HANDLE).catch(() => undefined);
          this.writer.stateful = session_types.stateless;
        }
      }),
    );
  }

  syntaxCheck(objectUri: string, sourceUri: string, source: string): Promise<Diagnostic[]> {
    return this.call(async () => {
      const results = await this.reader.syntaxCheck(sourceUri, objectUri, source);
      return results.map((r) => ({
        line: Math.max(1, r.line || 1),
        column: Math.max(1, (r.offset || 0) + 1),
        severity: severityOf(r.severity),
        text: r.text,
        source: "sap" as const,
        uri: stripFragment(r.uri || sourceUri),
      }));
    });
  }

  completion(sourceUri: string, source: string, line: number, column: number): Promise<CompletionItem[]> {
    return this.call(async () => {
      const proposals = await this.reader.codeCompletion(sourceUri, source, line, column);
      const before = (source.split("\n")[line - 1] ?? "").slice(0, column);
      const seen = new Set<string>();
      const items: CompletionItem[] = [];
      // LOCATION ranks proposals by where they are defined (local first), as in Eclipse.
      for (const p of [...proposals].sort((a, b) => (a.LOCATION ?? 0) - (b.LOCATION ?? 0))) {
        const prefixLength = p.PREFIXLENGTH || 0;
        const afterArrow = /[-=]>$/.test(before.slice(0, before.length - prefixLength));
        const label = String(p.IDENTIFIER) + (p.ROLE === INTERFACE_ROLE && afterArrow ? "~" : "");
        if (seen.has(label)) continue;
        seen.add(label);
        items.push({ label, kind: "other", prefixLength });
      }
      return items;
    });
  }

  definition(sourceUri: string, source: string, line: number, startColumn: number, endColumn: number): Promise<DefinitionTarget | null> {
    return this.call(async () => {
      const target = await this.reader.findDefinition(sourceUri, source, line, startColumn, endColumn, false);
      if (!target.url) return null;
      return { uri: stripFragment(target.url), line: Math.max(1, target.line || 1), column: (target.column || 0) + 1 };
    });
  }

  activate(name: string, objectUri: string): Promise<ActivationOutcome> {
    return this.call(async () => {
      const result = await this.reader.activate(name, objectUri);
      return {
        success: result.success,
        messages: result.messages.map((m) => ({
          severity: severityOf(m.type),
          text: m.shortText,
          line: m.line || undefined,
          uri: m.href ? stripFragment(m.href) : undefined,
        })),
      };
    });
  }

  prettyPrint(source: string): Promise<string> {
    return this.call(() => this.reader.prettyPrinter(source));
  }

  inactiveObjects(): Promise<ObjectRef[]> {
    return this.call(async () => {
      const records = await this.reader.inactiveObjects();
      return records
        .map((r) => r.object)
        .filter((o): o is NonNullable<typeof o> => !!o && o.user.toUpperCase() === this.info.user)
        .map((o) => ({ name: o["adtcore:name"], type: o["adtcore:type"], uri: o["adtcore:uri"], description: o["adtcore:description"] }));
    });
  }

  create(request: CreateRequest): Promise<CreateOutcome> {
    return this.call(async () => {
      const name = request.name.trim().toUpperCase();
      const packageName = request.packageName.trim().toUpperCase();
      const uri = objectPath(request.type, name.toLowerCase(), packageName);
      let transport = request.transport;
      if (!transport) {
        const info = await this.writer.transportInfo(uri, packageName, "I");
        if (info.LOCKS?.HEADER?.TRKORR) transport = info.LOCKS.HEADER.TRKORR;
        else if (info.DLVUNIT !== "LOCAL") {
          return {
            status: "needsTransport",
            packageName,
            transports: (info.TRANSPORTS ?? []).map((t) => ({ number: t.TRKORR, text: t.AS4TEXT, owner: t.AS4USER })),
          } satisfies CreateOutcome;
        }
      }
      await this.writer.createObject({
        objtype: request.type,
        name,
        parentName: packageName,
        parentPath: `/sap/bc/adt/packages/${encodeURIComponent(packageName.toLowerCase())}`,
        description: request.description.trim(),
        transport,
      });
      return { status: "created", uri, transport } satisfies CreateOutcome;
    });
  }

  runClass(className: string): Promise<string> {
    return this.call(() => this.reader.runClass(className));
  }

  unitTests(objectUri: string): Promise<UnitTestClassResult[]> {
    return this.call(async () => {
      const classes = await this.reader.unitTestRun(objectUri);
      return classes.map((c) => ({
        name: c["adtcore:name"],
        ...locate(c.navigationUri ?? c["adtcore:uri"]),
        alerts: c.alerts.map(toAlert),
        methods: c.testmethods.map((m) => ({
          name: m["adtcore:name"],
          ...locate(m.navigationUri ?? m["adtcore:uri"]),
          time: m.executionTime,
          alerts: m.alerts.map(toAlert),
        })),
      }));
    });
  }

  async close(): Promise<void> {
    await this.writer.logout().catch(() => undefined);
  }
}
