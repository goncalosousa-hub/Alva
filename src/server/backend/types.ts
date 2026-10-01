import type {
  ActivationOutcome,
  CompletionItem,
  DefinitionTarget,
  Diagnostic,
  ObjectRef,
  OpenedObject,
  SaveOutcome,
  SaveRequest,
  SessionInfo,
  TreeNode,
} from "../../shared/types.js";

/**
 * Everything the IDE needs from an ABAP system. One implementation talks to a real
 * system through the ADT REST API, the other is an in-memory demo system.
 */
export interface AbapBackend {
  readonly info: SessionInfo;
  search(query: string, type: string | undefined, max: number): Promise<ObjectRef[]>;
  /** Children of a package (or, with no name, nothing — the client asks for named packages). */
  packageContents(packageName: string): Promise<TreeNode[]>;
  open(uri: string, version?: "active" | "inactive"): Promise<OpenedObject>;
  save(request: SaveRequest): Promise<SaveOutcome>;
  syntaxCheck(objectUri: string, sourceUri: string, source: string): Promise<Diagnostic[]>;
  completion(sourceUri: string, source: string, line: number, column: number): Promise<CompletionItem[]>;
  /** line is 1-based, columns are 0-based character offsets of the word. */
  definition(sourceUri: string, source: string, line: number, startColumn: number, endColumn: number): Promise<DefinitionTarget | null>;
  activate(name: string, objectUri: string): Promise<ActivationOutcome>;
  prettyPrint(source: string): Promise<string>;
  inactiveObjects(): Promise<ObjectRef[]>;
  close(): Promise<void>;
}

/** An error the API should report to the user with a specific HTTP status. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
