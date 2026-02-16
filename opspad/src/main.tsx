import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";

function renderFatal(err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;

  const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
  const escaped = msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  root.innerHTML = `
    <div style="padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; color: #e8eef7;">
      <div style="font-weight: 700; margin-bottom: 8px;">OpsPad failed to start</div>
      <pre style="white-space: pre-wrap; overflow: auto; background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.10);">${escaped}</pre>
      <div style="opacity: 0.75; margin-top: 10px; font-size: 12px;">
        If this happens in an installed build, please share the message above.
      </div>
    </div>
  `;
}

// Surface startup errors instead of showing a blank window.
window.addEventListener("error", (ev) => renderFatal((ev as ErrorEvent).error ?? (ev as ErrorEvent).message));
window.addEventListener("unhandledrejection", (ev) => renderFatal((ev as PromiseRejectionEvent).reason));

try {
  const el = document.getElementById("root") as HTMLElement | null;
  if (!el) throw new Error("Missing #root element");
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (e) {
  renderFatal(e);
}
