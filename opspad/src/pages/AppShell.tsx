import { useEffect, useState, type CSSProperties } from "react";

import { CommandDock } from "../ui/CommandDock";
import type { HostListItem } from "../ui/HostsSidebar";
import { HostsSidebar } from "../ui/HostsSidebar";
import { TerminalWorkspace } from "../ui/TerminalWorkspace";

export function AppShell() {
  const [connectRequest, setConnectRequest] = useState<{
    host: HostListItem;
    nonce: string;
  } | null>(null);
  const [ctx, setCtx] = useState<{
    kind: "local" | "ssh";
    environmentTag: string;
    hostId?: string | null;
    connected?: boolean;
  }>({ kind: "local", environmentTag: "LOCAL", hostId: null, connected: false });
  const [hostsCollapsed, setHostsCollapsed] = useState(false);
  const [terminalActive, setTerminalActive] = useState(false);

  // "Terminal focus mode": dim side panes briefly while the user is typing.
  useEffect(() => {
    let t: number | null = null;
    const onActivity = () => {
      setTerminalActive(true);
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => setTerminalActive(false), 1400);
    };
    window.addEventListener("opspad-terminal-activity", onActivity as EventListener);
    return () => {
      if (t) window.clearTimeout(t);
      window.removeEventListener("opspad-terminal-activity", onActivity as EventListener);
    };
  }, []);

  return (
    <div className={terminalActive ? "appRoot appRootFocus" : "appRoot"}>
      <header className="topBar" role="banner">
        <div className="brand">
          <div className="brandMark" aria-hidden="true" />
          <div className="brandText">
            <div className="brandName">OpsPad</div>
            <div className="brandTag">SSH workspace + CommandDock</div>
          </div>
        </div>

        <div className="topBarRight">
          <div className="envBadge" title="Active context">
            {ctx.environmentTag}
          </div>
          <button className="topIconButton" type="button">
            Settings
          </button>
        </div>
      </header>

      <div
        className="appGrid"
        role="application"
        aria-label="OpsPad workspace"
        style={
          {
            // Collapse the left pane to an "edge tabs" width; center reflows automatically.
            ["--left-width" as never]: hostsCollapsed ? "64px" : "280px",
          } as CSSProperties
        }
      >
        <aside className="leftPane">
          <HostsSidebar
            collapsed={hostsCollapsed}
            onToggleCollapsed={() => setHostsCollapsed((v) => !v)}
            activeHostId={ctx.kind === "ssh" ? (ctx.hostId ?? null) : null}
            onConnect={(h) =>
              setConnectRequest({
                host: h,
                nonce:
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : String(Date.now()),
              })
            }
          />
        </aside>
        <main className="centerPane">
          <TerminalWorkspace connectRequest={connectRequest} onContextChange={setCtx} />
        </main>
        <aside className="rightPane">
          <CommandDock activeEnvironmentTag={ctx.environmentTag} />
        </aside>
      </div>
    </div>
  );
}
