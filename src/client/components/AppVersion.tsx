import { useEffect, useState } from "react";
import { desktop } from "./UpdateButton";

/** "Alva 0.3.1" in the desktop app (nothing in the browser, where there is no installed version). */
export function AppVersion({ className }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void desktop?.version().then(setVersion);
  }, []);
  if (!version) return null;
  return <span className={className}>Alva {version}</span>;
}
