import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useStore } from "../store";

const ICONS = { success: CheckCircle2, error: AlertCircle, warning: AlertTriangle, info: Info };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.level];
        return (
          <div key={t.id} className={`toast toast-${t.level}`}>
            <Icon size={16} />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
