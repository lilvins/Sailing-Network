import { Component, type ErrorInfo, type ReactNode } from "react";

/** A crash while drawing the page would leave it blank, with no clue why. This
 *  shows the error instead and tells the server, whose console logs it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch("/api/client-errors", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(error.message).slice(0, 500),
        stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`.slice(0, 4000),
        url: window.location.pathname,
      }),
    }).catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 24, background: "#0d1420", color: "#f2f3f5", textAlign: "center" }}>
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Something broke on this page</h1>
          <p style={{ marginBottom: 12, overflowWrap: "anywhere" }}><code>{error.message}</code></p>
          <p style={{ marginBottom: 18, opacity: 0.75 }}>Reload to go back to your game: it is saved.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
