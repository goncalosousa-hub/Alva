/**
 * The IDE's behaviour: open/save/activate/check objects, keep Monaco models, markers and the
 * local linter in sync with the store, and plug ABAP intelligence into Monaco.
 */
import type { CompletionItem, Diagnostic, ObjectRef, OpenedObject, Severity } from "../shared/types";
import { api, ApiError } from "./api";
import type { LintRequest, LintResponse } from "./lint.worker";
import { getModel, modelUri, monaco } from "./monaco";
import { prefs } from "./prefs";
import { activeTab, getState, log, setState, systemKey, toast, updateTab, type Tab } from "./store";

// ---------------------------------------------------------------------------------------------
// Editor instance and per-tab view state

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const pendingReveal = new Map<string, { line: number; column: number }>();

export function setEditor(e: monaco.editor.IStandaloneCodeEditor | null) {
  editor = e;
}

export function getEditor() {
  return editor;
}

/** Position to reveal the next time the tab is shown (set when opening at a definition). */
export function takePendingReveal(key: string) {
  const pos = pendingReveal.get(key);
  pendingReveal.delete(key);
  return pos;
}

export function reveal(line: number, column = 1) {
  if (!editor) return;
  editor.setPosition({ lineNumber: line, column });
  editor.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column });
  editor.focus();
}

// ---------------------------------------------------------------------------------------------
// URIs

/** Same rule as the server: ".../source/main" or ".../includes/x" belong to the object above. */
export function splitSourceUri(uri: string): { objectUri: string; sourceUri?: string } {
  const clean = uri.replace(/[?#].*$/, "");
  const m = clean.match(/^(.*?)\/(source\/main|includes\/[a-z]+)$/i);
  return m ? { objectUri: m[1], sourceUri: clean } : { objectUri: clean };
}

function findTab(uri: string): Tab | undefined {
  const { objectUri, sourceUri } = splitSourceUri(uri);
  const { tabs } = getState();
  return sourceUri ? tabs.find((t) => t.key === sourceUri) : tabs.find((t) => t.ref.uri === objectUri && /\/source\/main$/.test(t.key));
}

// ---------------------------------------------------------------------------------------------
// Markers

const SEVERITY: Record<Severity, monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
};

function toMarker(model: monaco.editor.ITextModel, d: Diagnostic): monaco.editor.IMarkerData {
  const lines = model.getLineCount();
  const line = Math.min(Math.max(1, d.line), lines);
  const maxCol = model.getLineMaxColumn(line);
  const startColumn = Math.min(Math.max(1, d.column), maxCol);
  let endLineNumber = d.endLine && d.endLine >= line ? Math.min(d.endLine, lines) : line;
  let endColumn = d.endColumn ?? 0;
  if (endLineNumber === line && endColumn <= startColumn) {
    const word = model.getWordAtPosition({ lineNumber: line, column: startColumn });
    endColumn = word && word.endColumn > startColumn ? word.endColumn : maxCol;
    if (endColumn <= startColumn) {
      endLineNumber = line;
      endColumn = startColumn + 1;
    }
  }
  return {
    severity: SEVERITY[d.severity],
    message: d.text,
    source: d.source === "sap" ? "SAP" : "abaplint",
    code: d.code,
    startLineNumber: line,
    startColumn,
    endLineNumber,
    endColumn,
  };
}

function setMarkers(key: string, owner: "sap" | "abaplint", diagnostics: Diagnostic[]) {
  const model = getModel(key);
  if (!model) return;
  monaco.editor.setModelMarkers(
    model,
    owner,
    diagnostics.filter((d) => !d.uri || d.uri === key).map((d) => toMarker(model, d)),
  );
}

// ---------------------------------------------------------------------------------------------
// Local analysis (abaplint in a web worker)

const worker = new Worker(new URL("./lint.worker.ts", import.meta.url), { type: "module" });
const lintTimers = new Map<string, ReturnType<typeof setTimeout>>();

worker.onmessage = (event: MessageEvent<LintResponse>) => {
  const { key, version, diagnostics, outline } = event.data;
  const model = getModel(key);
  if (!model || model.getVersionId() !== version) return; // stale result
  setMarkers(key, "abaplint", diagnostics);
  updateTab(key, { localDiagnostics: diagnostics, outline });
};

function scheduleLint(key: string, delay = 250) {
  clearTimeout(lintTimers.get(key));
  lintTimers.set(
    key,
    setTimeout(() => {
      lintTimers.delete(key);
      const tab = getState().tabs.find((t) => t.key === key);
      const model = getModel(key);
      if (!tab || !model || tab.language !== "abap") return;
      const { settings } = getState();
      const req: LintRequest = {
        key,
        version: model.getVersionId(),
        name: tab.ref.name,
        type: tab.ref.type,
        include: tab.include && tab.include !== "main" ? tab.include : undefined,
        source: model.getValue(),
        release: settings.release,
        lint: settings.liveLint,
      };
      worker.postMessage(req);
    }, delay),
  );
}

/** Re-run the linter on every open tab (after changing the ABAP release, for instance). */
export function relintAll() {
  for (const tab of getState().tabs) {
    if (!getState().settings.liveLint) {
      setMarkers(tab.key, "abaplint", []);
      updateTab(tab.key, { localDiagnostics: [] });
    }
    scheduleLint(tab.key, 0);
  }
}

// ---------------------------------------------------------------------------------------------
// Models

/** Objects fetched for "peek definition" that are not open in a tab yet. */
const pool = new Map<string, { obj: OpenedObject; savedVersionId: number }>();

function createModel(obj: OpenedObject): monaco.editor.ITextModel {
  const existing = getModel(obj.sourceUri);
  if (existing) return existing;
  const model = monaco.editor.createModel(obj.source, obj.language, modelUri(obj.sourceUri));
  model.onDidChangeContent(() => {
    const key = obj.sourceUri;
    const tab = getState().tabs.find((t) => t.key === key);
    if (!tab) return;
    const dirty = model.getAlternativeVersionId() !== tab.savedVersionId;
    if (dirty !== tab.dirty) updateTab(key, { dirty });
    scheduleLint(key);
  });
  return model;
}

/** Loads (or reuses) the model behind a URI without opening a tab, for peek/go-to definition. */
async function ensureModel(uri: string): Promise<monaco.editor.ITextModel> {
  const tab = findTab(uri);
  if (tab) return getModel(tab.key)!;
  const { sourceUri } = splitSourceUri(uri);
  if (sourceUri && getModel(sourceUri)) return getModel(sourceUri)!;
  const obj = await api.open(uri);
  const model = createModel(obj);
  pool.set(obj.sourceUri, { obj, savedVersionId: model.getAlternativeVersionId() });
  return model;
}

function rememberRecent(ref: ObjectRef) {
  const { session } = getState();
  if (!session) return;
  const key = systemKey(session);
  const recent = prefs.recent(key).filter((r) => r.uri !== ref.uri);
  prefs.saveRecent(key, [ref, ...recent]);
}

// ---------------------------------------------------------------------------------------------
// Opening and closing

const opening = new Map<string, Promise<void>>();

export function openObject(uri: string, position?: { line: number; column: number }): Promise<void> {
  const existing = findTab(uri);
  if (existing) {
    if (position) pendingReveal.set(existing.key, position);
    if (getState().activeKey === existing.key && position) {
      takePendingReveal(existing.key);
      reveal(position.line, position.column);
    }
    setState({ activeKey: existing.key });
    return Promise.resolve();
  }
  const inflight = opening.get(uri);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const { sourceUri } = splitSourceUri(uri);
      const pooled = sourceUri ? pool.get(sourceUri) : undefined;
      const obj = pooled?.obj ?? (await api.open(uri));
      const model = createModel(obj);
      pool.delete(obj.sourceUri);
      const savedVersionId = pooled?.savedVersionId ?? model.getAlternativeVersionId();
      const tab: Tab = {
        key: obj.sourceUri,
        ref: obj.ref,
        sourceUri: obj.sourceUri,
        language: obj.language,
        version: obj.version,
        etag: obj.etag,
        include: obj.include,
        includes: obj.includes,
        savedVersionId,
        dirty: model.getAlternativeVersionId() !== savedVersionId,
        localDiagnostics: [],
        sapDiagnostics: [],
        outline: [],
      };
      if (position) pendingReveal.set(tab.key, position);
      setState((s) => ({
        tabs: s.tabs.some((t) => t.key === tab.key) ? s.tabs : [...s.tabs, tab],
        activeKey: tab.key,
      }));
      rememberRecent(obj.ref);
      scheduleLint(tab.key, 0);
      log("info", `Aberto ${obj.ref.name} (${obj.ref.type}${obj.version === "inactive" ? ", versão inativa" : ""})`);
    } catch (e) {
      toast("error", `Não foi possível abrir: ${errorText(e)}`);
    } finally {
      opening.delete(uri);
    }
  })();
  opening.set(uri, task);
  return task;
}

function disposeTab(key: string) {
  const { tabs, activeKey } = getState();
  const index = tabs.findIndex((t) => t.key === key);
  if (index < 0) return;
  const rest = tabs.filter((t) => t.key !== key);
  const nextActive = activeKey === key ? (rest[index] ?? rest[index - 1] ?? null)?.key ?? null : activeKey;
  setState({ tabs: rest, activeKey: nextActive });
  clearTimeout(lintTimers.get(key));
  // Dispose after React switched the editor to another model.
  setTimeout(() => getModel(key)?.dispose(), 0);
}

export function closeTab(key: string) {
  const tab = getState().tabs.find((t) => t.key === key);
  if (!tab) return;
  if (!tab.dirty) return disposeTab(key);
  setState({
    overlay: {
      kind: "confirm",
      title: "Alterações por gravar",
      message: `${tab.ref.name} tem alterações que não foram gravadas. Fechar e perdê-las?`,
      confirmLabel: "Fechar sem gravar",
      danger: true,
      onConfirm: () => disposeTab(key),
    },
  });
}

export function closeAllTabs() {
  const dirty = getState().tabs.filter((t) => t.dirty);
  const closeAll = () => getState().tabs.forEach((t) => disposeTab(t.key));
  if (!dirty.length) return closeAll();
  setState({
    overlay: {
      kind: "confirm",
      title: "Alterações por gravar",
      message: `${dirty.map((t) => t.ref.name).join(", ")} ${dirty.length === 1 ? "tem" : "têm"} alterações por gravar. Fechar tudo?`,
      confirmLabel: "Fechar tudo",
      danger: true,
      onConfirm: closeAll,
    },
  });
}

/** Re-reads the object from the system, dropping local changes. */
export async function reloadTab(key: string) {
  const tab = getState().tabs.find((t) => t.key === key);
  const model = getModel(key);
  if (!tab || !model) return;
  try {
    const obj = await api.open(tab.sourceUri);
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: obj.source }], () => null);
    updateTab(key, {
      etag: obj.etag,
      version: obj.version,
      savedVersionId: model.getAlternativeVersionId(),
      dirty: false,
      sapDiagnostics: [],
    });
    setMarkers(key, "sap", []);
    toast("info", `${tab.ref.name} recarregado do sistema`);
  } catch (e) {
    toast("error", `Não foi possível recarregar: ${errorText(e)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Save, check, activate, format

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type SaveResult = "saved" | "needsTransport" | "failed";

export async function save(key: string, opts: { transport?: string; force?: boolean; then?: "save" | "activate" } = {}): Promise<SaveResult> {
  const tab = getState().tabs.find((t) => t.key === key);
  const model = getModel(key);
  if (!tab || !model || tab.busy === "saving") return "failed";
  const source = model.getValue();
  const versionId = model.getAlternativeVersionId();
  updateTab(key, { busy: "saving" });
  try {
    const result = await api.save({
      objectUri: tab.ref.uri,
      sourceUri: tab.sourceUri,
      source,
      etag: tab.etag,
      transport: opts.transport ?? tab.transport,
      force: opts.force,
    });
    if (result.status === "needsTransport") {
      updateTab(key, { busy: undefined });
      setState({ overlay: { kind: "transport", tabKey: key, transports: result.transports, packageName: result.packageName, then: opts.then ?? "save" } });
      return "needsTransport";
    }
    updateTab(key, (t) => ({
      busy: undefined,
      etag: result.etag,
      savedVersionId: versionId,
      dirty: model.getAlternativeVersionId() !== versionId,
      version: "inactive",
      transport: result.transport ?? t.transport,
    }));
    setState((s) => ({ repositoryVersion: s.repositoryVersion + 1 }));
    log("success", `Gravado ${tab.ref.name}${result.transport ? ` (ordem ${result.transport})` : ""}`);
    if (getState().settings.checkOnSave && tab.language === "abap") void check(key, { quiet: true });
    return "saved";
  } catch (e) {
    updateTab(key, { busy: undefined });
    if (e instanceof ApiError && e.code === "conflict") {
      setState({
        overlay: {
          kind: "confirm",
          title: "Conflito de versões",
          message: `${tab.ref.name} foi alterado no sistema depois de o abrires. Substituir a versão do sistema pela tua? (Alternativa: recarregar e perder as tuas alterações.)`,
          confirmLabel: "Substituir",
          danger: true,
          onConfirm: () =>
            void save(key, { ...opts, force: true }).then(async (r) => {
              if (r === "saved" && opts.then === "activate") await activate(key);
            }),
        },
      });
      return "failed";
    }
    toast("error", `Erro ao gravar ${tab.ref.name}: ${errorText(e)}`);
    return "failed";
  }
}

export async function saveAll() {
  for (const tab of getState().tabs.filter((t) => t.dirty)) {
    const r = await save(tab.key);
    if (r !== "saved") return;
  }
}

function showProblems() {
  setState({ panelVisible: true, panelTab: "problems" });
}

export async function check(key: string, { quiet = false } = {}) {
  const tab = getState().tabs.find((t) => t.key === key);
  const model = getModel(key);
  if (!tab || !model) return;
  // A background check (after save) must not block saving/activating meanwhile.
  if (!quiet) updateTab(key, { busy: tab.busy ?? "checking" });
  try {
    const diagnostics = await api.check(tab.ref.uri, tab.sourceUri, model.getValue());
    setMarkers(key, "sap", diagnostics);
    updateTab(key, (t) => ({ sapDiagnostics: diagnostics, busy: t.busy === "checking" ? undefined : t.busy }));
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;
    if (errors) {
      toast("error", `${tab.ref.name}: ${errors} erro(s) de sintaxe`);
      showProblems();
    } else if (!quiet) {
      toast("success", warnings ? `${tab.ref.name}: sem erros (${warnings} aviso(s))` : `${tab.ref.name}: sem erros de sintaxe`);
    }
  } catch (e) {
    updateTab(key, (t) => ({ busy: t.busy === "checking" ? undefined : t.busy }));
    if (!quiet) toast("error", `Verificação falhou: ${errorText(e)}`);
  }
}

export async function activate(key: string) {
  const tab = getState().tabs.find((t) => t.key === key);
  if (!tab || tab.busy === "saving" || tab.busy === "activating") return;
  // Activation covers the whole object: save every changed include of it first.
  const siblings = () => getState().tabs.filter((t) => t.ref.uri === tab.ref.uri);
  for (const t of [tab, ...siblings().filter((t) => t.key !== key)]) {
    if (!getState().tabs.find((x) => x.key === t.key)?.dirty) continue;
    const saved = await save(t.key, t.key === key ? { then: "activate" } : {});
    if (saved !== "saved") return;
  }
  updateTab(key, { busy: "activating" });
  try {
    const result = await api.activate(tab.ref.name, tab.ref.uri);
    if (result.success) {
      updateTab(key, { busy: undefined });
      for (const t of siblings()) updateTab(t.key, { version: "active" });
      toast("success", `${tab.ref.name} ativado`);
      for (const m of result.messages) log(m.severity === "error" ? "error" : "warning", `${tab.ref.name}: ${m.text}`);
    } else {
      const diagnostics: Diagnostic[] = result.messages.map((m) => ({
        line: m.line ?? 1,
        column: 1,
        severity: m.severity,
        text: m.text,
        source: "sap",
        uri: m.uri && splitSourceUri(m.uri).sourceUri ? splitSourceUri(m.uri).sourceUri : key,
      }));
      // Each message goes to the tab of its include when that one is open, otherwise to this tab.
      const byTab = new Map<string, Diagnostic[]>([[key, []]]);
      for (const d of diagnostics) {
        const target = getState().tabs.some((t) => t.key === d.uri) ? d.uri! : key;
        byTab.set(target, [...(byTab.get(target) ?? []), target === key ? { ...d, uri: key } : d]);
      }
      for (const [k, list] of byTab) {
        setMarkers(k, "sap", list);
        updateTab(k, { sapDiagnostics: list });
      }
      updateTab(key, { busy: undefined });
      toast("error", `${tab.ref.name} não foi ativado: ${result.messages[0]?.text ?? "erros de ativação"}`);
      showProblems();
    }
    setState((s) => ({ repositoryVersion: s.repositoryVersion + 1 }));
  } catch (e) {
    updateTab(key, { busy: undefined });
    toast("error", `Erro ao ativar ${tab.ref.name}: ${errorText(e)}`);
  }
}

/** Activates objects that are not open (from the "inactive objects" view). */
export async function activateRefs(refs: ObjectRef[]) {
  let ok = 0;
  for (const ref of refs) {
    const tab = findTab(ref.uri);
    if (tab) {
      await activate(tab.key);
      if (getState().tabs.find((t) => t.key === tab.key)?.version === "active") ok++;
      continue;
    }
    try {
      const result = await api.activate(ref.name, ref.uri);
      if (result.success) ok++;
      else toast("error", `${ref.name} não foi ativado: ${result.messages[0]?.text ?? "erros de ativação"}`);
    } catch (e) {
      toast("error", `Erro ao ativar ${ref.name}: ${errorText(e)}`);
    }
  }
  if (ok) toast("success", ok === 1 ? "1 objeto ativado" : `${ok} objetos ativados`);
  setState((s) => ({ repositoryVersion: s.repositoryVersion + 1 }));
}

export async function format(key: string) {
  const tab = getState().tabs.find((t) => t.key === key);
  const model = getModel(key);
  if (!tab || !model || tab.language !== "abap") return;
  updateTab(key, { busy: "formatting" });
  try {
    const source = model.getValue();
    const result = await api.prettyPrint(source);
    if (result.source !== source) {
      const selections = editor?.getModel() === model ? editor.getSelections() : null;
      model.pushStackElement();
      model.pushEditOperations(selections ?? [], [{ range: model.getFullModelRange(), text: result.source }], () => selections);
      model.pushStackElement();
    }
    updateTab(key, { busy: undefined });
  } catch (e) {
    updateTab(key, { busy: undefined });
    toast("error", `Pretty printer falhou: ${errorText(e)}`);
  }
}

export function goToDefinition() {
  if (!editor) return;
  editor.focus();
  // trigger() also reaches actions registered as commands (getAction() does not).
  editor.trigger("keyboard", "editor.action.revealDefinition", {});
}

export async function logout() {
  const dirty = getState().tabs.some((t) => t.dirty);
  const doLogout = async () => {
    await api.logout().catch(() => undefined);
    resetWorkspace();
  };
  if (!dirty) return doLogout();
  setState({
    overlay: {
      kind: "confirm",
      title: "Terminar sessão",
      message: "Há objetos com alterações por gravar. Terminar a sessão e perdê-las?",
      confirmLabel: "Terminar sessão",
      danger: true,
      onConfirm: () => void doLogout(),
    },
  });
}

/** Back to the logon screen: drop tabs, models and anything tied to the old session. */
export function resetWorkspace() {
  for (const model of monaco.editor.getModels()) if (model.uri.scheme === "adt") model.dispose();
  pool.clear();
  setState({ session: null, tabs: [], activeKey: null, overlay: null, cursor: null });
}

// ---------------------------------------------------------------------------------------------
// Monaco language features

/** ABAP identifiers may contain namespaces (/ABC/CL_X) — wider than Monaco's default word. */
function abapWordAt(model: monaco.editor.ITextModel, position: monaco.Position) {
  const text = model.getLineContent(position.lineNumber);
  const re = /[A-Za-z0-9_/]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (position.column - 1 >= start && position.column - 1 <= end) return { start, end, word: m[0] };
  }
  return null;
}

const KIND: Record<CompletionItem["kind"], monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  variable: monaco.languages.CompletionItemKind.Variable,
  method: monaco.languages.CompletionItemKind.Method,
  class: monaco.languages.CompletionItemKind.Class,
  type: monaco.languages.CompletionItemKind.Interface,
  function: monaco.languages.CompletionItemKind.Function,
  field: monaco.languages.CompletionItemKind.Field,
  constant: monaco.languages.CompletionItemKind.Constant,
  other: monaco.languages.CompletionItemKind.Text,
};

const SYMBOL_KIND: Record<string, monaco.languages.SymbolKind> = {
  class: monaco.languages.SymbolKind.Class,
  interface: monaco.languages.SymbolKind.Interface,
  method: monaco.languages.SymbolKind.Method,
  attribute: monaco.languages.SymbolKind.Field,
  type: monaco.languages.SymbolKind.Struct,
  form: monaco.languages.SymbolKind.Function,
  function: monaco.languages.SymbolKind.Function,
  module: monaco.languages.SymbolKind.Module,
  event: monaco.languages.SymbolKind.Event,
};

let languageFeaturesRegistered = false;

export function registerLanguageFeatures() {
  if (languageFeaturesRegistered) return;
  languageFeaturesRegistered = true;

  monaco.languages.registerCompletionItemProvider("abap", {
    triggerCharacters: [">", "-", "~"],
    async provideCompletionItems(model, position, context, token) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      // No server round trip inside comments and strings, or for operators that are not component selectors.
      if (/^\*/.test(before) || /"/.test(before) || ((before.match(/'/g) ?? []).length % 2 === 1)) return { suggestions: [] };
      if (context.triggerCharacter === ">" && !/[-=]>$/.test(before)) return { suggestions: [] };
      if (context.triggerCharacter === "-" && !/\w-$/.test(before)) return { suggestions: [] };
      try {
        const items = await api.completion(model.uri.path, model.getValue(), position.lineNumber, position.column - 1);
        if (token.isCancellationRequested) return { suggestions: [] };
        return {
          suggestions: items.map((item, i) => ({
            label: item.label,
            kind: KIND[item.kind],
            detail: item.detail,
            insertText: item.label,
            sortText: String(i).padStart(5, "0"),
            range: new monaco.Range(position.lineNumber, Math.max(1, position.column - item.prefixLength), position.lineNumber, position.column),
          })),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  monaco.languages.registerDefinitionProvider("abap", {
    async provideDefinition(model, position) {
      const word = abapWordAt(model, position);
      if (!word) return null;
      try {
        const { target } = await api.definition(model.uri.path, model.getValue(), position.lineNumber, word.start, word.end);
        if (!target) {
          toast("info", `Definição de ${word.word} não encontrada`, { logIt: false });
          return null;
        }
        const targetModel = splitSourceUri(target.uri).sourceUri === model.uri.path ? model : await ensureModel(target.uri);
        return { uri: targetModel.uri, range: new monaco.Range(target.line, target.column, target.line, target.column) };
      } catch (e) {
        toast("error", `Navegação falhou: ${errorText(e)}`, { logIt: false });
        return null;
      }
    },
  });

  monaco.languages.registerDocumentSymbolProvider("abap", {
    provideDocumentSymbols(model) {
      const tab = getState().tabs.find((t) => t.key === model.uri.path);
      if (!tab) return [];
      const lines = model.getLineCount();
      const toSymbol = (item: Tab["outline"][number]): monaco.languages.DocumentSymbol => {
        const line = Math.min(item.line, lines);
        const end = Math.min(Math.max(item.endLine, line), lines);
        return {
          name: item.name,
          detail: item.detail ?? "",
          kind: SYMBOL_KIND[item.kind] ?? monaco.languages.SymbolKind.Object,
          tags: [],
          range: new monaco.Range(line, 1, end, model.getLineMaxColumn(end)),
          selectionRange: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
          children: item.children.map(toSymbol),
        };
      };
      return tab.outline.map(toSymbol);
    },
  });

  // Go-to-definition into another object opens (or focuses) its tab.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== "adt") return false;
      let position: { line: number; column: number } | undefined;
      if (selectionOrPosition && "startLineNumber" in selectionOrPosition) {
        position = { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn };
      } else if (selectionOrPosition) {
        position = { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column };
      }
      void openObject(resource.path, position);
      return true;
    },
  });
}

/** For the problems view: every diagnostic of every open tab. */
export function allProblems(tabs: Tab[]) {
  return tabs.flatMap((tab) =>
    [...tab.sapDiagnostics, ...tab.localDiagnostics].map((d) => ({ tab, diagnostic: d })),
  );
}

export function activeTabKey() {
  return activeTab()?.key;
}
