import { Component, type ReactNode } from "react";

/** A rendering error shows a message and a way out, instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Alva UI error", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>O Alva encontrou um erro</h1>
        <p>As alterações já gravadas estão no sistema SAP. Recarrega a janela para continuar.</p>
        <pre>{String(this.state.error.stack ?? this.state.error.message)}</pre>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    );
  }
}
