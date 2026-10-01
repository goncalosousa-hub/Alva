import type {
  ActivationOutcome,
  ApiErrorBody,
  CompletionItem,
  ConnectionInput,
  DefinitionTarget,
  Diagnostic,
  ObjectRef,
  OpenedObject,
  SaveOutcome,
  SaveRequest,
  SessionInfo,
  TreeNode,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Called when the server says the SAP session is gone, so the UI can go back to the logon screen. */
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "x-alva": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Sem ligação ao servidor do Alva", 0, "offline");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as ApiErrorBody;
    if (res.status === 401 && path !== "/api/session") onUnauthorized?.();
    throw new ApiError(err.error || `Erro ${res.status}`, res.status, err.code);
  }
  return data as T;
}

export const api = {
  session: () => call<SessionInfo | null>("GET", "/api/session"),
  login: (input: ConnectionInput) => call<SessionInfo>("POST", "/api/session", input),
  loginDemo: () => call<SessionInfo>("POST", "/api/session", { demo: true }),
  logout: () => call<void>("DELETE", "/api/session"),
  search: (q: string, type?: string, signal?: AbortSignal) =>
    call<ObjectRef[]>("GET", `/api/search?${new URLSearchParams({ q, ...(type ? { type } : {}), max: "60" })}`, undefined, signal),
  packageContents: (name: string) => call<TreeNode[]>("GET", `/api/packages/${encodeURIComponent(name)}`),
  open: (uri: string) => call<OpenedObject>("GET", `/api/object?${new URLSearchParams({ uri })}`),
  save: (request: SaveRequest) => call<SaveOutcome>("POST", "/api/object/save", request),
  check: (objectUri: string, sourceUri: string, source: string) => call<Diagnostic[]>("POST", "/api/object/check", { objectUri, sourceUri, source }),
  completion: (sourceUri: string, source: string, line: number, column: number) =>
    call<CompletionItem[]>("POST", "/api/object/completion", { sourceUri, source, line, column }),
  definition: (sourceUri: string, source: string, line: number, startColumn: number, endColumn: number) =>
    call<{ target: DefinitionTarget | null }>("POST", "/api/object/definition", { sourceUri, source, line, startColumn, endColumn }),
  activate: (name: string, objectUri: string) => call<ActivationOutcome>("POST", "/api/object/activate", { name, objectUri }),
  prettyPrint: (source: string) => call<{ source: string }>("POST", "/api/prettyprint", { source }),
  inactive: () => call<ObjectRef[]>("GET", "/api/inactive"),
};
