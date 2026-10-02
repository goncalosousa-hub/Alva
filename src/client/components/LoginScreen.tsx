import { FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { ENVIRONMENTS, prefs, type Environment, type SystemProfile } from "../prefs";
import { setState, toast } from "../store";
import { AppVersion } from "./AppVersion";
import { Toasts } from "./Toasts";
import { checkForUpdates, desktop, UpdateButton } from "./UpdateButton";

type Draft = Omit<SystemProfile, "id"> & { id?: string };

const EMPTY: Draft = { name: "", environment: "DEV", url: "", client: "", user: "", language: "PT", allowSelfSigned: false, rememberPassword: false };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function EnvBadge({ env }: { env?: Environment }) {
  if (!env || env === "OUTRO") return null;
  return <span className={`env-badge env-${env.toLowerCase()}`}>{env}</span>;
}

export function LoginScreen() {
  const [systems, setSystems] = useState(prefs.systems);
  const [form, setForm] = useState<Draft>(() => systems[0] ?? EMPTY);
  const [password, setPassword] = useState("");
  const [canStore, setCanStore] = useState(false);
  const [busy, setBusy] = useState<"login" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void desktop?.canStorePasswords().then(setCanStore);
  }, []);

  // A remembered password fills in when its system is chosen.
  useEffect(() => {
    setPassword("");
    const saved = systems.find((s) => s.id === form.id);
    if (saved?.rememberPassword) void desktop?.getPassword(saved.id).then((p) => p && setPassword(p));
    // Only when another system is chosen; ticking "memorizar" must not clear what was typed.
  }, [form.id]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Stores the profile (and, when asked, the password) and returns it. */
  async function store(draft: Draft, overrides: Partial<SystemProfile> = {}): Promise<SystemProfile> {
    const profile: SystemProfile = {
      ...draft,
      ...overrides,
      id: draft.id ?? newId(),
      name: (overrides.name ?? draft.name).trim() || draft.url.trim() || "Sistema",
    };
    const next = [profile, ...systems.filter((s) => s.id !== profile.id)];
    prefs.saveSystems(next);
    setSystems(next);
    setForm(profile);
    if (desktop) {
      if (profile.rememberPassword && password) await desktop.setPassword(profile.id, password);
      else if (!profile.rememberPassword) await desktop.deletePassword(profile.id);
    }
    return profile;
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy("login");
    setError(null);
    try {
      const session = await api.login({
        url: form.url.trim(),
        user: form.user.trim(),
        password,
        client: form.client.trim(),
        language: form.language.trim(),
        allowSelfSigned: form.allowSelfSigned,
      });
      // Keep the address the server found (e.g. http://10.10.98.24:8000 for "10.10.98.24").
      const profile = await store(form, { url: session.url, name: form.name.trim() || session.systemId });
      setState({ session, profile: { name: profile.name, environment: profile.environment } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function saveOnly() {
    if (!form.url.trim()) {
      setError("Indica pelo menos o servidor para guardar o sistema.");
      return;
    }
    setError(null);
    const profile = await store(form);
    toast("success", `Sistema «${profile.name}» guardado`, { logIt: false });
  }

  async function demo() {
    setBusy("demo");
    setError(null);
    try {
      setState({ session: await api.loginDemo(), profile: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  function removeSystem(id: string) {
    const next = systems.filter((s) => s.id !== id);
    prefs.saveSystems(next);
    setSystems(next);
    void desktop?.deletePassword(id);
    if (form.id === id) setForm(next[0] ?? EMPTY);
  }

  return (
    <div className="login">
      <Toasts />
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Alva</h1>
            <p>Desenvolvimento ABAP rápido e moderno.</p>
          </div>
          <div className="login-update">
            <UpdateButton />
          </div>
        </div>

        <div className="login-body">
          <div className="login-systems">
            <div className="label">Sistemas</div>
            <ul aria-label="Sistemas guardados">
              {systems.map((s) => (
                <li key={s.id} className={s.id === form.id ? "selected" : ""}>
                  <button type="button" className="system" onClick={() => (setForm(s), setError(null))}>
                    <EnvBadge env={s.environment} />
                    <span className="system-name">{s.name}</span>
                    <span className="system-meta">
                      {s.user || "—"} · {s.client || "—"}
                    </span>
                  </button>
                  <button type="button" className="icon-button" title={`Esquecer ${s.name}`} onClick={() => removeSystem(s.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
              <li className={!form.id ? "selected" : ""}>
                <button type="button" className="system" onClick={() => (setForm(EMPTY), setError(null))}>
                  <Plus size={15} />
                  <span className="system-name">Novo sistema</span>
                </button>
              </li>
            </ul>
            {systems.length === 0 && <p className="hint">Guarda DEV, QAS e PRD para entrares com um clique.</p>}
          </div>

          <form className="login-form" onSubmit={connect}>
            <label>
              Nome
              <input placeholder="S4 DEV – Lusiaves" value={form.name} onChange={(e) => set("name", e.target.value)} name="name" />
            </label>
            <label>
              Ambiente
              <select value={form.environment ?? "OUTRO"} onChange={(e) => set("environment", e.target.value as Environment)} name="environment">
                {ENVIRONMENTS.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.id === "OUTRO" ? env.label : `${env.id} – ${env.label}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              URL do sistema
              <input
                required
                placeholder="10.10.98.56  ou  https://10.10.98.56:44300"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                autoComplete="url"
                name="url"
              />
              <span className="field-hint">
                Basta o servidor (ex.: 10.10.98.24): o Alva procura a porta do SAP. Também podes indicar o URL completo ou colar o da página de
                login do SAP GUI para HTML / Fiori.
              </span>
            </label>
            <label>
              Mandante
              <input placeholder="100" value={form.client} onChange={(e) => set("client", e.target.value)} maxLength={3} name="client" />
            </label>
            <label>
              Idioma
              <input placeholder="PT" value={form.language} onChange={(e) => set("language", e.target.value.toUpperCase())} maxLength={2} name="language" />
            </label>
            <label>
              Utilizador
              <input required value={form.user} onChange={(e) => set("user", e.target.value)} autoComplete="username" name="user" />
            </label>
            <label>
              Palavra-passe
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" name="password" />
            </label>
            <label className="checkbox span-2">
              <input type="checkbox" checked={form.allowSelfSigned} onChange={(e) => set("allowSelfSigned", e.target.checked)} />
              Aceitar certificados autoassinados / CA interna
            </label>
            {canStore && (
              <label className="checkbox span-2">
                <input type="checkbox" checked={!!form.rememberPassword} onChange={(e) => set("rememberPassword", e.target.checked)} />
                Memorizar a palavra-passe neste computador (encriptada pelo sistema operativo)
              </label>
            )}
            {form.environment === "PRD" && (
              <div className="form-warning span-2">Sistema de produção: as alterações que gravares e ativares afetam o negócio.</div>
            )}
            {error && (
              <div className="form-error span-2" role="alert">
                {error}
              </div>
            )}
            <div className="login-actions span-2">
              <button className="ghost" type="button" onClick={() => void saveOnly()} disabled={busy !== null} title="Guardar o sistema sem ligar">
                <Save size={15} /> Guardar
              </button>
              <button className="primary" type="submit" disabled={busy !== null}>
                {busy === "login" ? "A procurar o sistema e a ligar…" : "Ligar"}
              </button>
            </div>
          </form>
        </div>

        <div className="login-demo">
          <button type="button" className="ghost" onClick={demo} disabled={busy !== null}>
            <FlaskConical size={16} />
            {busy === "demo" ? "A preparar…" : "Experimentar com o sistema demo (sem SAP)"}
          </button>
        </div>
        <div className="login-meta">
          <AppVersion className="login-version" />
          {desktop && (
            <button type="button" className="link-button" onClick={() => void checkForUpdates()}>
              Procurar atualizações
            </button>
          )}
        </div>
        <p className="login-note">
          {canStore
            ? "Os sistemas ficam guardados neste computador; a palavra-passe só se escolheres memorizá-la, encriptada pelo sistema operativo."
            : "A palavra-passe só é usada para abrir a sessão ADT e nunca é guardada no browser."}{" "}
          O sistema precisa do serviço ADT ativo (SICF <code>/sap/bc/adt</code>).
        </p>
      </div>
    </div>
  );
}
