import { FlaskConical, Plug, Server, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { prefs, type SystemProfile } from "../prefs";
import { setState } from "../store";

const EMPTY: Omit<SystemProfile, "id"> = { name: "", url: "", client: "", user: "", language: "PT", allowSelfSigned: false };

export function LoginScreen() {
  const [systems, setSystems] = useState(prefs.systems);
  const [form, setForm] = useState<Omit<SystemProfile, "id"> & { id?: string }>(() => systems[0] ?? EMPTY);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"login" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SystemProfile>(key: K, value: SystemProfile[K]) => setForm((f) => ({ ...f, [key]: value }));

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
      // Remember the system (never the password).
      const profile: SystemProfile = { ...form, id: form.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: form.name.trim() || session.systemId };
      const next = [profile, ...systems.filter((s) => s.id !== profile.id)];
      prefs.saveSystems(next);
      setState({ session });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function demo() {
    setBusy("demo");
    setError(null);
    try {
      setState({ session: await api.loginDemo() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  function removeSystem(id: string) {
    const next = systems.filter((s) => s.id !== id);
    prefs.saveSystems(next);
    setSystems(next);
    if (form.id === id) setForm(next[0] ?? EMPTY);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Alva</h1>
            <p>Desenvolvimento ABAP rápido, no browser.</p>
          </div>
        </div>

        <div className="login-body">
          {systems.length > 0 && (
            <div className="login-systems">
              <div className="label">Sistemas</div>
              <ul>
                {systems.map((s) => (
                  <li key={s.id} className={s.id === form.id ? "selected" : ""}>
                    <button type="button" className="system" onClick={() => setForm(s)}>
                      <Server size={15} />
                      <span className="system-name">{s.name}</span>
                      <span className="system-meta">
                        {s.user} · {s.client || "—"}
                      </span>
                    </button>
                    <button type="button" className="icon-button" title="Esquecer sistema" onClick={() => removeSystem(s.id)}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
                <li className={!form.id ? "selected" : ""}>
                  <button type="button" className="system" onClick={() => setForm(EMPTY)}>
                    <Plug size={15} />
                    <span className="system-name">Novo sistema…</span>
                  </button>
                </li>
              </ul>
            </div>
          )}

          <form className="login-form" onSubmit={connect}>
            <label className="span-2">
              URL do sistema
              <input
                required
                placeholder="https://10.10.98.56:44300"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                autoComplete="url"
                name="url"
              />
              <span className="field-hint">
                O endereço HTTP(S) do servidor SAP — podes colar o da página de login do SAP GUI para HTML ou do Fiori. Portas habituais: 443<em>NN</em> (HTTPS)
                ou 80<em>NN</em> (HTTP), com <em>NN</em> = nº de instância.
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
            <label className="span-2">
              Nome (opcional)
              <input placeholder="S4D – Desenvolvimento" value={form.name} onChange={(e) => set("name", e.target.value)} name="name" />
            </label>
            <label className="checkbox span-2">
              <input type="checkbox" checked={form.allowSelfSigned} onChange={(e) => set("allowSelfSigned", e.target.checked)} />
              Aceitar certificados autoassinados / CA interna
            </label>
            {error && (
              <div className="form-error span-2" role="alert">
                {error}
              </div>
            )}
            <button className="primary span-2" type="submit" disabled={busy !== null}>
              {busy === "login" ? "A ligar…" : "Ligar"}
            </button>
          </form>
        </div>

        <div className="login-demo">
          <button type="button" className="ghost" onClick={demo} disabled={busy !== null}>
            <FlaskConical size={16} />
            {busy === "demo" ? "A preparar…" : "Experimentar com o sistema demo (sem SAP)"}
          </button>
        </div>
        <p className="login-note">
          A palavra-passe só é usada para abrir a sessão ADT neste servidor local e nunca é guardada no browser. O sistema precisa do serviço ADT ativo
          (SICF <code>/sap/bc/adt</code>).
        </p>
      </div>
    </div>
  );
}
