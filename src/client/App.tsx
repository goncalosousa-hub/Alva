import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { currentTheme } from "./commands";
import { registerLanguageFeatures, resetWorkspace } from "./ide";
import { monaco } from "./monaco";
import { setState, toast, useStore } from "./store";
import { LoginScreen } from "./components/LoginScreen";
import { Workbench } from "./components/Workbench";

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const resolved = currentTheme();
    document.documentElement.dataset.theme = resolved;
    monaco.editor.setTheme(resolved === "dark" ? "alva-dark" : "alva-light");
  }, [theme, systemDark]);
}

export function App() {
  const session = useStore((s) => s.session);
  const [checking, setChecking] = useState(true);
  useTheme();

  useEffect(() => {
    registerLanguageFeatures();
    setUnauthorizedHandler(() => {
      if (!useStore.getState().session) return;
      resetWorkspace();
      toast("warning", "A sessão SAP terminou. Volta a ligar-te.");
    });
    api
      .session()
      .then((s) => setState({ session: s }))
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="boot" aria-busy="true" />;
  return session ? <Workbench /> : <LoginScreen />;
}
