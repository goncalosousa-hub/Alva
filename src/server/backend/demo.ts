import { lintSource, prettyPrint, type SourceFile } from "../../shared/abaplint.js";
import {
  CLASS_INCLUDE_LABELS,
  type ActivationOutcome,
  type CompletionItem,
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
  type UnitTestClassResult,
} from "../../shared/types.js";
import { DEMO_OBJECTS, DEMO_PACKAGES, DEMO_TRANSPORTS, type DemoObject } from "./demo-data.js";
import { BackendError, type AbapBackend } from "./types.js";
import { etagOf, languageOf, splitSourceUri } from "./util.js";

interface StoredSource {
  active: string;
  /** Saved but not yet activated. */
  inactive?: string;
}

interface StoredObject extends Omit<DemoObject, "source" | "includes"> {
  uri: string;
  /** Sources by include: "main" for programs/interfaces, plus the class includes. */
  sources: Map<string, StoredSource>;
  changedAt: Date;
  changedBy: string;
  /** Transport that records changes of this object, once one was chosen. */
  transport?: string;
}

const TYPE_PATHS: Record<string, string> = {
  "PROG/P": "programs/programs",
  "CLAS/OC": "oo/classes",
  "INTF/OI": "oo/interfaces",
};

const TYPE_LABELS: Record<string, string> = {
  "DEVC/K": "Pacotes",
  "PROG/P": "Programas",
  "CLAS/OC": "Classes",
  "INTF/OI": "Interfaces",
};

/** Same order as Eclipse's class editor tabs. */
const INCLUDE_ORDER = ["main", "definitions", "implementations", "macros", "testclasses"];

const KEYWORDS = (
  "ABSTRACT AND APPEND ASSIGN AT BEGIN BREAK-POINT CASE CATCH CHANGING CHECK CLASS CLASS-DATA CLASS-METHODS CLEAR COND CONSTANTS " +
  "CONTINUE CONV CORRESPONDING CREATE DATA DEFAULT DEFINITION DELETE DESCRIBE DO ELSE ELSEIF ENDCASE ENDCLASS ENDDO ENDFORM ENDIF " +
  "ENDINTERFACE ENDLOOP ENDMETHOD ENDSELECT ENDTRY ENDWHILE EXIT EXPORTING FIELD-SYMBOLS FINAL FORM FROM IF IMPLEMENTATION IMPORTING " +
  "INSERT INTERFACE INTERFACES INTO IS LOOP METHOD METHODS MODIFY NEW NOT OR PARAMETERS PERFORM PRIVATE PROTECTED PUBLIC RAISE " +
  "RAISING READ REDUCE REF REPORT RETURN RETURNING SECTION SELECT SORT START-OF-SELECTION TABLE TRY TYPE TYPES VALUE WHEN WHERE WHILE WRITE"
).split(" ");

const DEMO_USER = "DEVELOPER";

/** Standard SAP objects the demo code uses, declared so the demo syntax check knows them. */
const SAP_STUBS: SourceFile[] = [
  {
    name: "IF_OO_ADT_CLASSRUN_OUT",
    type: "INTF/OI",
    source: `INTERFACE if_oo_adt_classrun_out PUBLIC.
  METHODS write IMPORTING data TYPE any name TYPE string OPTIONAL RETURNING VALUE(output) TYPE REF TO if_oo_adt_classrun_out.
ENDINTERFACE.`,
  },
  {
    name: "IF_OO_ADT_CLASSRUN",
    type: "INTF/OI",
    source: `INTERFACE if_oo_adt_classrun PUBLIC.
  METHODS main IMPORTING out TYPE REF TO if_oo_adt_classrun_out.
ENDINTERFACE.`,
  },
];

function sourceUriOf(o: StoredObject, include: string): string {
  return include === "main" ? `${o.uri}/source/main` : `${o.uri}/includes/${include}`;
}

function includeOf(sourceUri: string | undefined): string {
  const m = sourceUri?.match(/\/includes\/([a-z]+)$/i);
  return m ? m[1].toLowerCase() : "main";
}

export class DemoBackend implements AbapBackend {
  readonly info: SessionInfo = {
    systemId: "DEMO",
    url: "demo://alva",
    user: DEMO_USER,
    client: "001",
    language: "PT",
    demo: true,
  };

  private readonly objects = new Map<string, StoredObject>();

  constructor() {
    for (const { source, includes, ...o } of DEMO_OBJECTS) {
      const uri = `/sap/bc/adt/${TYPE_PATHS[o.type]}/${o.name.toLowerCase()}`;
      const sources = new Map<string, StoredSource>([["main", { active: source }]]);
      for (const [kind, text] of Object.entries(includes ?? {})) sources.set(kind, { active: text });
      this.objects.set(uri, { ...o, uri, sources, changedAt: new Date("2026-09-01T10:00:00Z"), changedBy: DEMO_USER });
    }
  }

  private all(): StoredObject[] {
    return [...this.objects.values()];
  }

  private get(uri: string): StoredObject {
    const { objectUri } = splitSourceUri(uri);
    const obj = this.objects.get(objectUri.toLowerCase());
    if (!obj) throw new BackendError(`Objeto não encontrado: ${uri}`, 404, "notFound");
    return obj;
  }

  private source(o: StoredObject, include: string): StoredSource {
    const s = o.sources.get(include);
    if (!s) throw new BackendError(`Include não encontrado: ${o.name} ${include}`, 404, "notFound");
    return s;
  }

  private static current(s: StoredSource): string {
    return s.inactive ?? s.active;
  }

  private isInactive(o: StoredObject): boolean {
    return [...o.sources.values()].some((s) => s.inactive !== undefined);
  }

  /** Every source of the system at its current (possibly inactive) state, except one, for cross-object checks. */
  private context(exceptObject: StoredObject, exceptInclude: string): SourceFile[] {
    const files: SourceFile[] = [...SAP_STUBS];
    for (const o of this.all()) {
      for (const [include, s] of o.sources) {
        if (o === exceptObject && include === exceptInclude) continue;
        files.push({ name: o.name, type: o.type, source: DemoBackend.current(s), include: include === "main" ? undefined : include });
      }
    }
    return files;
  }

  private ref(o: StoredObject): ObjectRef {
    return { name: o.name, type: o.type, uri: o.uri, description: o.description, packageName: o.packageName };
  }

  async search(query: string, type: string | undefined, max: number): Promise<ObjectRef[]> {
    const pattern = query.trim().toUpperCase();
    if (!pattern) return [];
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        (pattern.endsWith("*") ? "" : ".*") +
        "$",
    );
    const packages: ObjectRef[] = DEMO_PACKAGES.map((p) => ({
      name: p.name,
      type: "DEVC/K",
      uri: `/sap/bc/adt/packages/${encodeURIComponent(p.name.toLowerCase())}`,
      description: p.description,
      packageName: p.parent,
    }));
    const candidates = [...this.all().map((o) => this.ref(o)), ...packages];
    return candidates
      .filter((r) => regex.test(r.name) && (!type || r.type.startsWith(type.split("/")[0])))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, max);
  }

  async packageContents(packageName: string): Promise<TreeNode[]> {
    const name = packageName.toUpperCase();
    if (!DEMO_PACKAGES.some((p) => p.name === name)) throw new BackendError(`Pacote não encontrado: ${packageName}`, 404, "notFound");
    const subPackages: TreeNode[] = DEMO_PACKAGES.filter((p) => p.parent === name).map((p) => ({
      name: p.name,
      type: "DEVC/K",
      uri: `/sap/bc/adt/packages/${encodeURIComponent(p.name.toLowerCase())}`,
      description: p.description,
      packageName: name,
      expandable: true,
      category: TYPE_LABELS["DEVC/K"],
    }));
    const objects: TreeNode[] = this.all()
      .filter((o) => o.packageName === name)
      .map((o) => ({ ...this.ref(o), expandable: false, category: TYPE_LABELS[o.type] }));
    return [...subPackages, ...objects];
  }

  async open(uri: string, version?: "active" | "inactive"): Promise<OpenedObject> {
    if (uri.startsWith("/sap/bc/adt/packages/")) throw new BackendError("Os pacotes não têm código fonte", 400, "notSource");
    const o = this.get(uri);
    const include = includeOf(splitSourceUri(uri).sourceUri);
    const stored = this.source(o, include);
    const source = version === "active" ? stored.active : DemoBackend.current(stored);
    const isClass = o.type.startsWith("CLAS");
    return {
      ref: this.ref(o),
      sourceUri: sourceUriOf(o, include),
      source,
      version: version !== "active" && this.isInactive(o) ? "inactive" : "active",
      language: languageOf(o.type),
      editable: true,
      changedBy: o.changedBy,
      changedAt: o.changedAt.toISOString(),
      etag: etagOf(source),
      include: isClass ? include : undefined,
      includes: isClass
        ? INCLUDE_ORDER.filter((k) => o.sources.has(k)).map((kind) => ({ kind, label: CLASS_INCLUDE_LABELS[kind] ?? kind, uri: sourceUriOf(o, kind) }))
        : undefined,
    };
  }

  async save(request: SaveRequest): Promise<SaveOutcome> {
    const o = this.get(request.objectUri);
    const stored = this.source(o, includeOf(request.sourceUri));
    if (request.etag && !request.force && etagOf(DemoBackend.current(stored)) !== request.etag) {
      throw new BackendError("O objeto foi alterado no sistema desde que o abriste", 409, "conflict");
    }
    const pkg = DEMO_PACKAGES.find((p) => p.name === o.packageName);
    let transport = o.transport;
    if (!pkg?.local && !transport) {
      if (!request.transport) return { status: "needsTransport", packageName: o.packageName, transports: DEMO_TRANSPORTS };
      if (!DEMO_TRANSPORTS.some((t) => t.number === request.transport)) {
        throw new BackendError(`Ordem de transporte ${request.transport} não existe ou não é modificável`, 400, "transport");
      }
      transport = request.transport;
    }
    o.transport = transport;
    stored.inactive = request.source === stored.active ? undefined : request.source;
    o.changedAt = new Date();
    o.changedBy = DEMO_USER;
    return { status: "saved", etag: etagOf(request.source), transport };
  }

  /** Errors of one source as the system would report them (abaplint with the whole demo system as context). */
  private check(o: StoredObject, include: string, source: string): Diagnostic[] {
    const file: SourceFile = { name: o.name, type: o.type, source, include: include === "main" ? undefined : include };
    return lintSource(file, "v758", this.context(o, include), true).filter(
      (d) => d.severity === "error" || d.code === "check_syntax" || d.code === "unused_variables",
    );
  }

  async syntaxCheck(objectUri: string, sourceUri: string, source: string): Promise<Diagnostic[]> {
    const o = this.get(objectUri);
    return this.check(o, includeOf(sourceUri), source).map((d) => ({ ...d, source: "sap" as const, uri: sourceUri }));
  }

  async completion(_sourceUri: string, source: string, line: number, column: number): Promise<CompletionItem[]> {
    const text = source.split("\n")[line - 1] ?? "";
    const prefix = (text.slice(0, column).match(/[\w~/-]*$/) ?? [""])[0];
    if (!prefix) return [];
    const upper = prefix.toUpperCase();
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const add = (label: string, kind: CompletionItem["kind"], detail?: string) => {
      if (seen.has(label.toUpperCase()) || !label.toUpperCase().startsWith(upper) || label.length === prefix.length) return;
      seen.add(label.toUpperCase());
      items.push({ label, kind, detail, prefixLength: prefix.length });
    };
    for (const word of source.match(/\b[a-z_][\w]*\b/gi) ?? []) {
      if (/^(lv|lt|ls|lo|iv|it|is|io|rv|rt|rs|ro|mv|mt|ms|mo|gv|gt|p)_/i.test(word)) add(word, "variable");
    }
    for (const o of this.all()) add(o.name.toLowerCase(), o.type.startsWith("CLAS") ? "class" : o.type.startsWith("INTF") ? "type" : "other", o.description);
    for (const k of KEYWORDS) add(k, "keyword");
    return items.slice(0, 100);
  }

  async definition(sourceUri: string, source: string, line: number, startColumn: number, endColumn: number): Promise<DefinitionTarget | null> {
    const text = source.split("\n")[line - 1] ?? "";
    const word = text.slice(startColumn, endColumn).toLowerCase().replace(/[^\w/]/g, "");
    if (!word) return null;
    const target = this.all().find((o) => o.name.toLowerCase() === word);
    if (target) return { uri: sourceUriOf(target, "main"), line: 1, column: 1 };
    const declaration = new RegExp(
      `^\\s*(?:DATA|CLASS-DATA|CONSTANTS|TYPES|METHODS|CLASS-METHODS|FORM|PARAMETERS|INTERFACES)\\s*:?\\s+(${word})\\b|DATA\\((${word})\\)|\\b(${word})\\s+TYPE\\b`,
      "i",
    );
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = declaration.exec(lines[i]);
      if (m) {
        const col = lines[i].toLowerCase().indexOf(word, m.index);
        return { uri: sourceUri, line: i + 1, column: col + 1 };
      }
    }
    return null;
  }

  async activate(_name: string, objectUri: string): Promise<ActivationOutcome> {
    const o = this.get(objectUri);
    const pending = [...o.sources].filter(([, s]) => s.inactive !== undefined);
    if (!pending.length) return { success: true, messages: [] };
    const messages: ActivationOutcome["messages"] = [];
    for (const [include, s] of pending) {
      for (const d of this.check(o, include, s.inactive!).filter((d) => d.severity === "error")) {
        messages.push({ severity: "error", text: d.text, line: d.line, uri: sourceUriOf(o, include) });
      }
    }
    if (messages.length) return { success: false, messages };
    for (const [, s] of pending) {
      s.active = s.inactive!;
      s.inactive = undefined;
    }
    return { success: true, messages: [] };
  }

  async prettyPrint(source: string): Promise<string> {
    return prettyPrint({ name: "zpretty", type: "PROG/P", source });
  }

  async inactiveObjects(): Promise<ObjectRef[]> {
    return this.all()
      .filter((o) => this.isInactive(o))
      .map((o) => this.ref(o));
  }

  async create(request: CreateRequest): Promise<CreateOutcome> {
    const name = request.name.trim().toUpperCase();
    const packageName = request.packageName.trim().toUpperCase();
    const pkg = DEMO_PACKAGES.find((p) => p.name === packageName);
    if (!pkg) throw new BackendError(`O pacote ${packageName} não existe`, 400, "badRequest");
    const maxLength = request.type === "PROG/P" ? 40 : 30;
    if (!/^[ZY][A-Z0-9_]*$/.test(name) || name.length > maxLength) {
      throw new BackendError(`Nome inválido: ${name} (tem de começar por Z ou Y, até ${maxLength} caracteres A-Z, 0-9 e _)`, 400, "badRequest");
    }
    if (!request.description.trim()) throw new BackendError("A descrição é obrigatória", 400, "badRequest");
    const uri = `/sap/bc/adt/${TYPE_PATHS[request.type]}/${name.toLowerCase()}`;
    if (this.objects.has(uri)) throw new BackendError(`${name} já existe`, 409, "exists");
    let transport: string | undefined;
    if (!pkg.local) {
      if (!request.transport) return { status: "needsTransport", packageName, transports: DEMO_TRANSPORTS };
      if (!DEMO_TRANSPORTS.some((t) => t.number === request.transport)) {
        throw new BackendError(`Ordem de transporte ${request.transport} não existe ou não é modificável`, 400, "transport");
      }
      transport = request.transport;
    }
    const lower = name.toLowerCase();
    const templates: Record<string, string> =
      request.type === "PROG/P"
        ? { main: `REPORT ${lower}.\n` }
        : request.type === "INTF/OI"
          ? { main: `INTERFACE ${lower}\n  PUBLIC.\n\nENDINTERFACE.\n` }
          : {
              main: `CLASS ${lower} DEFINITION\n  PUBLIC\n  FINAL\n  CREATE PUBLIC.\n\n  PUBLIC SECTION.\n  PROTECTED SECTION.\n  PRIVATE SECTION.\nENDCLASS.\n\n\n\nCLASS ${lower} IMPLEMENTATION.\nENDCLASS.\n`,
              definitions: "",
              implementations: "",
              macros: "",
            };
    // A new object exists only as an inactive version until it is activated.
    const sources = new Map(Object.entries(templates).map(([kind, text]) => [kind, { active: "", inactive: text } as StoredSource]));
    this.objects.set(uri, {
      name,
      type: request.type,
      description: request.description.trim(),
      packageName,
      uri,
      sources,
      changedAt: new Date(),
      changedBy: DEMO_USER,
      transport,
    });
    return { status: "created", uri, transport };
  }

  async runClass(className: string): Promise<string> {
    const o = this.objects.get(`/sap/bc/adt/oo/classes/${className.toLowerCase()}`);
    if (!o) throw new BackendError(`Classe não encontrada: ${className}`, 404, "notFound");
    const main = o.sources.get("main")!.active;
    if (!/if_oo_adt_classrun~main/i.test(main)) {
      throw new BackendError(`${o.name} não implementa IF_OO_ADT_CLASSRUN`, 400, "notRunnable");
    }
    // The demo system cannot run ABAP: it echoes the literals written with out->write( ).
    const lines = [...main.matchAll(/out->write\(\s*(?:'([^']*)'|\|([^|]*)\||`([^`]*)`)\s*\)/gi)].map((m) => m[1] ?? m[2] ?? m[3]);
    return lines.join("\n") + "\n";
  }

  async unitTests(objectUri: string): Promise<UnitTestClassResult[]> {
    const o = this.get(objectUri);
    const include = o.sources.has("testclasses") ? "testclasses" : "main";
    const source = DemoBackend.current(this.source(o, include));
    const uri = sourceUriOf(o, include);
    const lines = source.split("\n");
    const lineOf = (re: RegExp) => {
      const i = lines.findIndex((l) => re.test(l));
      return i < 0 ? undefined : i + 1;
    };
    const results: UnitTestClassResult[] = [];
    // The demo system cannot run ABAP: a test fails when its method calls cl_abap_unit_assert=>fail.
    for (const cls of source.matchAll(/CLASS\s+(\w+)\s+DEFINITION[^.]*FOR TESTING[^.]*\.([\s\S]*?)ENDCLASS\./gi)) {
      const className = cls[1];
      const methods = [...cls[2].matchAll(/METHODS\s+(\w+)\s+FOR TESTING/gi)].map((m) => m[1]);
      if (!methods.length) continue; // test doubles: FOR TESTING classes without test methods
      const impl = source.match(new RegExp(`CLASS\\s+${className}\\s+IMPLEMENTATION\\.([\\s\\S]*?)ENDCLASS\\.`, "i"))?.[1] ?? "";
      results.push({
        name: className.toUpperCase(),
        uri,
        line: lineOf(new RegExp(`CLASS\\s+${className}\\s+DEFINITION`, "i")),
        alerts: [],
        methods: methods.map((name) => {
          const body = impl.match(new RegExp(`METHOD\\s+${name}\\.([\\s\\S]*?)ENDMETHOD\\.`, "i"))?.[1] ?? "";
          const line = lineOf(new RegExp(`^\\s*METHOD\\s+${name}\\.`, "i"));
          const fails = /cl_abap_unit_assert=>fail/i.test(body);
          return {
            name: name.toUpperCase(),
            uri,
            line,
            time: 0.001,
            alerts: fails ? [{ kind: "failedAssertion" as const, title: "Falha forçada (cl_abap_unit_assert=>fail)", details: [], uri, line }] : [],
          };
        }),
      });
    }
    return results;
  }

  async close(): Promise<void> {}
}
