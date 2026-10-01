// Monaco ESM sources imported through the "monaco-esm/" alias (see vite.config.ts).
declare module "monaco-esm/editor/editor.api.js" {
  export * from "monaco-editor";
}

declare module "monaco-esm/languages/definitions/abap/abap.js" {
  import type { languages } from "monaco-editor";
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}

declare module "monaco-esm/editor/editor.worker.js?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
