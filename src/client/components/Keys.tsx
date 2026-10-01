const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="keys">
      {shortcut.split("+").map((k, i) => (
        <kbd key={i}>{IS_MAC && k === "Ctrl" ? "⌘" : IS_MAC && k === "Alt" ? "⌥" : IS_MAC && k === "Shift" ? "⇧" : k}</kbd>
      ))}
    </span>
  );
}
