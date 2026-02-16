import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; info: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep this minimal: we just need something visible for release debugging.
    this.setState({ error, info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = `${this.state.error.name}: ${this.state.error.message}`;
    const stack = this.state.error.stack ?? "";
    const info = this.state.info ?? "";

    return (
      <div
        style={{
          height: "100%",
          padding: 16,
          color: "#e8eef7",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          background:
            "radial-gradient(900px 500px at 15% 10%, rgba(0, 180, 255, 0.16), transparent 60%)," +
            "radial-gradient(800px 500px at 85% 5%, rgba(255, 196, 0, 0.10), transparent 58%)," +
            "radial-gradient(700px 500px at 90% 95%, rgba(63, 227, 138, 0.09), transparent 55%)," +
            "linear-gradient(180deg, #071018, #0a1420)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>OpsPad crashed during UI render</div>
        <div style={{ opacity: 0.8, marginBottom: 10, fontSize: 12 }}>
          If this happens in an installed build, please share the details below.
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            overflow: "auto",
            background: "rgba(0,0,0,0.35)",
            padding: 12,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {msg}
          {"\n\n"}
          {stack}
          {info ? `\n\nComponent stack:\n${info}` : ""}
        </pre>
      </div>
    );
  }
}

