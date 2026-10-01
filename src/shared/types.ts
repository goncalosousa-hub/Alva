/** Types shared by the server (REST API) and the browser client. */

export interface ConnectionInput {
  /** Base URL of the ABAP system, e.g. https://vhcala4hci.local:44300 */
  url: string;
  user: string;
  password: string;
  /** SAP client (Mandant), e.g. "001" */
  client?: string;
  /** Logon language, e.g. "EN" or "PT" */
  language?: string;
  /** Accept self-signed / internal CA certificates (common on development systems). */
  allowSelfSigned?: boolean;
}

export interface SessionInfo {
  systemId: string;
  url: string;
  user: string;
  client: string;
  language: string;
  demo: boolean;
}

export interface ObjectRef {
  name: string;
  /** ADT type, e.g. PROG/P, CLAS/OC, INTF/OI, FUGR/FF, DEVC/K */
  type: string;
  /** ADT object URI, e.g. /sap/bc/adt/programs/programs/zhello */
  uri: string;
  description?: string;
  packageName?: string;
}

export interface TreeNode extends ObjectRef {
  expandable: boolean;
  /** Category folder ("Classes", "Programs"...) the node belongs to, when known. */
  category?: string;
}

export type ObjectVersion = "active" | "inactive";

export interface OpenedObject {
  ref: ObjectRef;
  /** URI of the text source the editor shows, e.g. .../source/main */
  sourceUri: string;
  source: string;
  version: ObjectVersion;
  /** Monaco language id for the source. */
  language: "abap" | "cds" | "plaintext";
  /** False for object types whose source cannot be written through ADT here. */
  editable: boolean;
  changedBy?: string;
  changedAt?: string;
  /** Hash of the source as read, sent back on save to detect concurrent changes. */
  etag: string;
  /** Class includes ("main", "testclasses", "definitions", ...): which one this source is, and all of them. */
  include?: string;
  includes?: ClassInclude[];
}

export interface ClassInclude {
  kind: string;
  label: string;
  /** Source URI of the include. */
  uri: string;
}

export const CLASS_INCLUDE_LABELS: Record<string, string> = {
  main: "Classe global",
  definitions: "Tipos locais (definições)",
  implementations: "Tipos locais (implementações)",
  macros: "Macros",
  testclasses: "Classes de teste",
};

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: Severity;
  text: string;
  /** Where the diagnostic comes from: the SAP system check or the local linter. */
  source: "sap" | "abaplint";
  /** Rule key for local findings, e.g. "obsolete_statement". */
  code?: string;
  /** Source URI the diagnostic belongs to. */
  uri?: string;
}

export type CompletionKind = "keyword" | "variable" | "method" | "class" | "type" | "function" | "field" | "constant" | "other";

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  /** How many characters before the cursor the proposal replaces. */
  prefixLength: number;
}

export interface DefinitionTarget {
  /** Source URI to open */
  uri: string;
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
}

export interface TransportOption {
  number: string;
  text: string;
  owner: string;
}

export interface SaveRequest {
  objectUri: string;
  sourceUri: string;
  source: string;
  /** Transport request chosen by the user, when the system asked for one. */
  transport?: string;
  /** etag of the source the edit started from; omit (or force) to overwrite unconditionally. */
  etag?: string;
  force?: boolean;
}

export type SaveOutcome =
  | { status: "saved"; etag: string; transport?: string }
  | { status: "needsTransport"; transports: TransportOption[]; packageName?: string };

export interface ActivationOutcome {
  success: boolean;
  messages: { severity: Severity; text: string; line?: number; uri?: string }[];
}

export interface ApiErrorBody {
  error: string;
  /** Machine readable reason, e.g. "unauthorized", "locked", "sap" */
  code?: string;
}
