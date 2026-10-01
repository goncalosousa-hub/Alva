/// <reference lib="webworker" />
// Must come before abaplint.
import "./buffer-shim";
import { lintSource, outline, type AbapRelease } from "../shared/abaplint";
import type { Diagnostic } from "../shared/types";

export interface LintRequest {
  key: string;
  version: number;
  name: string;
  type: string;
  include?: string;
  source: string;
  release: AbapRelease;
  lint: boolean;
}

export interface LintResponse {
  key: string;
  version: number;
  diagnostics: Diagnostic[];
  outline: ReturnType<typeof outline>;
}

self.onmessage = (event: MessageEvent<LintRequest>) => {
  const req = event.data;
  const file = { name: req.name, type: req.type, source: req.source, include: req.include };
  let diagnostics: Diagnostic[] = [];
  let items: LintResponse["outline"] = [];
  try {
    if (req.lint) diagnostics = lintSource(file, req.release);
    items = outline(file, req.release);
  } catch (e) {
    console.error("abaplint failed", e);
  }
  const response: LintResponse = { key: req.key, version: req.version, diagnostics, outline: items };
  (self as unknown as Worker).postMessage(response);
};
