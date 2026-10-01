import { createHash } from "node:crypto";
import type { OpenedObject, Severity } from "../../shared/types.js";

/** A short content hash the client sends back on save, to detect changes made by someone else meanwhile. */
export function etagOf(source: string): string {
  return createHash("sha1").update(source).digest("hex").slice(0, 16);
}

/** Drops "#start=..." fragments and query strings from an ADT URI. */
export function stripFragment(uri: string): string {
  return uri.replace(/[?#].*$/, "");
}

/**
 * Splits a URI that may point at a source include into the owning object URI and the source URI
 * (undefined when the URI is the object itself).
 */
export function splitSourceUri(uri: string): { objectUri: string; sourceUri?: string } {
  const clean = stripFragment(uri);
  const m = clean.match(/^(.*?)\/(source\/main|includes\/[a-z]+)$/i);
  if (m) return { objectUri: m[1], sourceUri: clean };
  return { objectUri: clean };
}

const CDS_TYPES = ["DDLS", "DCLS", "DDLX", "BDEF", "SRVD", "TABL", "DRTY", "DTEB"];

export function languageOf(type: string): OpenedObject["language"] {
  const main = type.split("/")[0].toUpperCase();
  if (CDS_TYPES.includes(main)) return "cds";
  if (["PROG", "CLAS", "INTF", "FUGR", "TYPE"].includes(main)) return "abap";
  return "plaintext";
}

export function severityOf(code: string | undefined): Severity {
  const c = (code ?? "").toUpperCase();
  if (c.startsWith("E") || c.startsWith("A") || c.startsWith("X")) return "error";
  if (c.startsWith("W")) return "warning";
  return "info";
}

/** Eclipse-like search: case-insensitive, with an implicit trailing wildcard. */
export function searchPattern(query: string): string {
  const q = query.trim().toUpperCase();
  if (!q) return q;
  return /[*?]$/.test(q) ? q : `${q}*`;
}
