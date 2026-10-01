/**
 * abaplint calls Buffer.from(hex, "hex").toString() while building its built-in constants;
 * browsers have no Buffer, so provide just that.
 */
const g = globalThis as { Buffer?: unknown };
if (!g.Buffer) {
  g.Buffer = {
    from(value: string, encoding?: string) {
      const bytes =
        encoding === "hex"
          ? Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16))
          : new TextEncoder().encode(value);
      return { toString: () => new TextDecoder().decode(bytes) };
    },
  };
}
export {};
