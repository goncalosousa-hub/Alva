/**
 * Local ABAP analysis with abaplint: instant diagnostics while typing, the outline and a
 * fallback pretty printer. Runs both in the browser (web worker) and on the server (demo system).
 */
import * as abaplint from "@abaplint/core";
import type { Diagnostic, Severity } from "./types.js";

import type { AbapRelease } from "./releases.js";

export type { AbapRelease };

/**
 * Rules that are meaningful on a single object without the rest of the system.
 * Anything needing the data dictionary or other objects is left to the SAP syntax check.
 */
const LOCAL_RULES: Record<string, Severity> = {
  parser_error: "error",
  parser_missing_space: "error",
  begin_end_names: "error",
  obsolete_statement: "warning",
  unreachable_code: "warning",
  empty_statement: "info",
  identical_conditions: "warning",
  when_others_last: "warning",
  try_without_catch: "warning",
  method_implemented_twice: "error",
  colon_missing_space: "info",
  space_before_dot: "info",
};

export interface SourceFile {
  name: string;
  /** ADT type, e.g. CLAS/OC */
  type: string;
  source: string;
  /** Class include ("testclasses", "definitions"...); the main source when omitted. */
  include?: string;
}

const CLASS_INCLUDE_FILES: Record<string, string> = {
  definitions: "locals_def",
  implementations: "locals_imp",
  macros: "macros",
  testclasses: "testclasses",
};

/** abaplint picks the object type from the file name, e.g. zcl_foo.clas.abap, zcl_foo.clas.testclasses.abap */
export function abaplintFilename(name: string, type: string, include?: string): string {
  const base = name.toLowerCase().replace(/\//g, "#");
  const main = type.split("/")[0].toUpperCase();
  switch (main) {
    case "CLAS":
      return include && CLASS_INCLUDE_FILES[include] ? `${base}.clas.${CLASS_INCLUDE_FILES[include]}.abap` : `${base}.clas.abap`;
    case "INTF":
      return `${base}.intf.abap`;
    default:
      // Programs, includes, function modules and anything else: parsed as program source.
      return `${base}.prog.abap`;
  }
}

function makeConfig(release: AbapRelease, withSyntax: boolean): abaplint.Config {
  const conf = abaplint.Config.getDefault(release as abaplint.Version).get();
  const rules: Record<string, unknown> = {};
  for (const key of Object.keys(LOCAL_RULES)) rules[key] = conf.rules[key] ?? true;
  if (withSyntax) {
    rules.check_syntax = true;
    rules.unused_variables = true;
  }
  conf.rules = rules;
  return new abaplint.Config(JSON.stringify(conf));
}

function toDiagnostic(issue: abaplint.Issue, withSyntax: boolean): Diagnostic {
  const key = issue.getKey();
  const severity: Severity = LOCAL_RULES[key] ?? (key === "check_syntax" && withSyntax ? "error" : "warning");
  const start = issue.getStart();
  const end = issue.getEnd();
  return {
    line: start.getRow(),
    column: start.getCol(),
    endLine: end.getRow(),
    endColumn: end.getCol(),
    severity,
    text: issue.getMessage(),
    source: "abaplint",
    code: key,
  };
}

/**
 * Lints one source. `context` holds other objects of the same system so references between
 * them resolve; `withSyntax` turns on the full semantic check (only sensible when the
 * context is complete, as in the demo system).
 */
export function lintSource(file: SourceFile, release: AbapRelease = "v758", context: SourceFile[] = [], withSyntax = false): Diagnostic[] {
  const registry = new abaplint.Registry(makeConfig(release, withSyntax));
  const filename = abaplintFilename(file.name, file.type, file.include);
  registry.addFile(new abaplint.MemoryFile(filename, file.source));
  for (const other of context) {
    const otherName = abaplintFilename(other.name, other.type, other.include);
    if (otherName !== filename) registry.addFile(new abaplint.MemoryFile(otherName, other.source));
  }
  registry.parse();
  return registry
    .findIssues()
    .filter((i) => i.getFilename() === filename)
    .map((i) => toDiagnostic(i, withSyntax));
}

export interface OutlineItem {
  name: string;
  kind: "class" | "interface" | "method" | "attribute" | "form" | "function" | "module" | "event" | "type";
  /** 1-based */
  line: number;
  /** Last line of the block (ENDMETHOD, ENDCLASS...), or of the statement. */
  endLine: number;
  detail?: string;
  children: OutlineItem[];
}

const S = abaplint.Statements;

type Kind =
  | "ClassDefinition"
  | "ClassImplementation"
  | "Interface"
  | "EndClass"
  | "EndInterface"
  | "MethodDef"
  | "MethodImplementation"
  | "EndMethod"
  | "Data"
  | "ClassData"
  | "Constant"
  | "Type"
  | "Form"
  | "EndForm"
  | "FunctionModule"
  | "EndFunction"
  | "Module"
  | "EndModule"
  | "Event";

/** Statement classes are matched with instanceof: class names do not survive minification. */
const KINDS: [new () => unknown, Kind][] = [
  [S.ClassDefinition, "ClassDefinition"],
  [S.ClassImplementation, "ClassImplementation"],
  [S.Interface, "Interface"],
  [S.EndClass, "EndClass"],
  [S.EndInterface, "EndInterface"],
  [S.MethodDef, "MethodDef"],
  [S.MethodImplementation, "MethodImplementation"],
  [S.EndMethod, "EndMethod"],
  [S.Data, "Data"],
  [S.ClassData, "ClassData"],
  [S.Constant, "Constant"],
  [S.Type, "Type"],
  [S.Form, "Form"],
  [S.EndForm, "EndForm"],
  [S.FunctionModule, "FunctionModule"],
  [S.EndFunction, "EndFunction"],
  [S.Module, "Module"],
  [S.EndModule, "EndModule"],
  [S.StartOfSelection, "Event"],
  [S.EndOfSelection, "Event"],
  [S.Initialization, "Event"],
  [S.AtSelectionScreen, "Event"],
  [S.AtLineSelection, "Event"],
  [S.AtUserCommand, "Event"],
  [S.TopOfPage, "Event"],
  [S.EndOfPage, "Event"],
  [S.LoadOfProgram, "Event"],
];

function statementKind(statement: unknown): Kind | undefined {
  for (const [cls, kind] of KINDS) if (statement instanceof cls) return kind;
  return undefined;
}

const CLOSERS: Partial<Record<Kind, OutlineItem["kind"][]>> = {
  EndClass: ["class"],
  EndInterface: ["interface"],
  EndMethod: ["method"],
  EndForm: ["form"],
  EndFunction: ["function"],
  EndModule: ["module"],
};

function nameAfterKeyword(text: string): string {
  const m = text.match(/^[\w-]+\s*:?\s+([\w~/<>]+)/);
  return m ? m[1] : text;
}

/** A structural outline (classes, methods, forms, events...) built from the parsed statements. */
export function outline(file: SourceFile, release: AbapRelease = "v758"): OutlineItem[] {
  const registry = new abaplint.Registry(makeConfig(release, false));
  registry.addFile(new abaplint.MemoryFile(abaplintFilename(file.name, file.type, file.include), file.source));
  registry.parse();
  const obj = registry.getFirstObject();
  if (!(obj instanceof abaplint.ABAPObject)) return [];

  const lastLine = file.source.split("\n").length;
  const root: OutlineItem[] = [];
  /** Blocks waiting for their END... statement. */
  const open: OutlineItem[] = [];
  let container: OutlineItem | undefined;
  let event: OutlineItem | undefined;
  const closeEvent = (line: number) => {
    if (event) event.endLine = Math.max(event.line, line);
    event = undefined;
  };

  for (const abapFile of obj.getABAPFiles()) {
    for (const statement of abapFile.getStatements()) {
      const kind = statementKind(statement.get());
      if (!kind) continue;
      const line = statement.getFirstToken().getRow();
      const endLine = statement.getLastToken().getRow();
      const text = statement.concatTokens();
      const name = nameAfterKeyword(text);
      const item = (k: OutlineItem["kind"], detail?: string): OutlineItem => ({ name, kind: k, line, endLine, detail, children: [] });

      const closes = CLOSERS[kind];
      if (closes) {
        for (let i = open.length - 1; i >= 0; i--) {
          if (closes.includes(open[i].kind)) {
            open[i].endLine = endLine;
            open.splice(i);
            break;
          }
        }
        if (kind === "EndClass" || kind === "EndInterface") container = undefined;
        continue;
      }

      switch (kind) {
        case "ClassDefinition":
        case "ClassImplementation":
        case "Interface": {
          closeEvent(line - 1);
          const isImpl = kind === "ClassImplementation";
          const detail = isImpl ? "implementation" : /\bFOR TESTING\b/i.test(text) ? "definition, for testing" : "definition";
          container = item(kind === "Interface" ? "interface" : "class", detail);
          root.push(container);
          open.push(container);
          break;
        }
        case "MethodDef":
        case "MethodImplementation": {
          const method = item("method", kind === "MethodDef" && /^CLASS-/i.test(text) ? "static" : undefined);
          (container?.children ?? root).push(method);
          if (kind === "MethodImplementation") open.push(method);
          break;
        }
        case "Data":
        case "ClassData":
        case "Constant":
          if (container && container.detail !== "implementation") {
            container.children.push(item("attribute", kind === "Constant" ? "constant" : kind === "ClassData" ? "static" : undefined));
          }
          break;
        case "Type":
          if (container && container.detail !== "implementation") container.children.push(item("type"));
          break;
        case "Form":
        case "FunctionModule":
        case "Module": {
          closeEvent(line - 1);
          const block = item(kind === "Form" ? "form" : kind === "FunctionModule" ? "function" : "module");
          root.push(block);
          open.push(block);
          break;
        }
        case "Event":
          closeEvent(line - 1);
          event = { ...item("event"), name: text.replace(/\.$/, "") };
          root.push(event);
          break;
      }
    }
  }
  closeEvent(lastLine);
  return root;
}

/** abaplint's pretty printer (keyword upper case + indentation); the SAP one is preferred when connected. */
export function prettyPrint(file: SourceFile, release: AbapRelease = "v758"): string {
  const registry = new abaplint.Registry(makeConfig(release, false));
  registry.addFile(new abaplint.MemoryFile(abaplintFilename(file.name, file.type, file.include), file.source));
  registry.parse();
  const obj = registry.getFirstObject();
  if (!(obj instanceof abaplint.ABAPObject)) return file.source;
  const abapFile = obj.getABAPFiles()[0];
  if (!abapFile) return file.source;
  return new abaplint.PrettyPrinter(abapFile, registry.getConfig()).run();
}
