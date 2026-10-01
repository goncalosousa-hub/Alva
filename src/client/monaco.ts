import { conf as abapConf } from "monaco-esm/languages/definitions/abap/abap.js";
import EditorWorker from "monaco-esm/editor/editor.worker.js?worker";
import * as monaco from "./monaco-slim";

// Only the base editor worker is needed: ABAP intelligence comes from the SAP system and abaplint.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Monaco ships an ABAP grammar; adjust its configuration in place (its lazy loader applies this
// object when the language is first used, so replacing it with setLanguageConfiguration would lose).
Object.assign(abapConf, {
  // Ctrl+/ comments with " — a * only comments in column 1, which Monaco cannot guarantee.
  comments: { lineComment: '"' },
  brackets: [
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: "`", close: "`", notIn: ["string", "comment"] },
    { open: "|", close: "|", notIn: ["string", "comment"] },
  ],
  // ABAP names may carry a namespace: /ABC/CL_FOO
  wordPattern: /[A-Za-z0-9_/]+/,
} satisfies monaco.languages.LanguageConfiguration);

/** CDS (DDLS, DCLS, BDEF...) highlighting: SQL-like with annotations. */
monaco.languages.register({ id: "cds", extensions: [".ddls", ".asddls"], aliases: ["CDS", "cds"] });
monaco.languages.setLanguageConfiguration("cds", {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string"] },
  ],
});
monaco.languages.setMonarchTokensProvider("cds", {
  ignoreCase: true,
  keywords: [
    "define", "view", "entity", "root", "as", "select", "from", "where", "association", "to", "on", "composition", "of", "parent",
    "key", "virtual", "inner", "left", "right", "outer", "join", "cross", "union", "all", "group", "by", "having", "order", "distinct",
    "case", "when", "then", "else", "end", "cast", "and", "or", "not", "is", "null", "like", "between", "in", "exists", "with",
    "parameters", "projection", "provider", "contract", "extend", "annotate", "abstract", "custom", "table", "function", "returns",
    "implementation", "managed", "unmanaged", "behavior", "for", "persistent", "draft", "lock", "master", "dependent", "authorization",
    "etag", "field", "readonly", "mandatory", "create", "update", "delete", "action", "determination", "validation", "result",
    "use", "strict", "role", "grant", "aspect", "redirected", "exposure", "service", "expose", "type", "include", "structure",
  ],
  tokenizer: {
    root: [
      [/@[\w.]+/, "annotation"],
      [/\$[\w.]+/, "variable.predefined"],
      [/[a-z_][\w]*(?=\s*\()/, "function"],
      [/[a-z_][\w]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      { include: "@whitespace" },
      [/'([^'\\]|\\.)*'/, "string"],
      [/\d+(\.\d+)?/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[;,.:]/, "delimiter"],
      [/[=<>!+\-*/|]+/, "operator"],
    ],
    whitespace: [
      [/\s+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
});

monaco.editor.defineTheme("alva-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "7aa2ff", fontStyle: "bold" },
    { token: "comment", foreground: "6b7a90", fontStyle: "italic" },
    { token: "string", foreground: "9ece6a" },
    { token: "number", foreground: "ff9e64" },
    { token: "operator", foreground: "89ddff" },
    { token: "annotation", foreground: "e0af68" },
    { token: "function", foreground: "7dcfff" },
    { token: "type", foreground: "2ac3de" },
  ],
  colors: {
    "editor.background": "#14171f",
    "editor.lineHighlightBackground": "#1c2130",
    "editorLineNumber.foreground": "#3b4459",
    "editorLineNumber.activeForeground": "#a9b1d6",
    "editorGutter.background": "#14171f",
    "editor.selectionBackground": "#2d3f76",
    "editorIndentGuide.background1": "#232838",
    "editorWidget.background": "#1a1e29",
    "editorSuggestWidget.background": "#1a1e29",
    "editorSuggestWidget.selectedBackground": "#26304a",
    "minimap.background": "#14171f",
    "scrollbarSlider.background": "#2a314580",
  },
});

monaco.editor.defineTheme("alva-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "1f4fd6", fontStyle: "bold" },
    { token: "comment", foreground: "7a8394", fontStyle: "italic" },
    { token: "string", foreground: "2f7d32" },
    { token: "number", foreground: "b45309" },
    { token: "operator", foreground: "0e7490" },
    { token: "annotation", foreground: "a16207" },
    { token: "function", foreground: "0369a1" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.lineHighlightBackground": "#f3f6fb",
    "editorLineNumber.foreground": "#b6bdc9",
    "editorLineNumber.activeForeground": "#3b4252",
  },
});

export { monaco };

export function modelUri(sourceUri: string): monaco.Uri {
  return monaco.Uri.from({ scheme: "adt", path: sourceUri });
}

export function getModel(sourceUri: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(modelUri(sourceUri));
}
