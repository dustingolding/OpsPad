import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { terminalResize, terminalWrite } from "../lib/opspadApi";

type Props = {
  sessionId: string | null;
  sessionLabel: string;
  statusText?: string | null;
  themeColor?: string | null;
  environmentTag?: string | null;
  connectionMeta?: string | null;
};

type TerminalDataEvent = {
  sessionId: string;
  data: string;
};

declare global {
  interface WindowEventMap {
    "opspad-terminal-paste": CustomEvent<string>;
    "opspad-terminal-run": CustomEvent<string | { text: string; dockCommandId?: string; dockCommandTitle?: string; dockCommandTemplate?: string }>;
    "opspad-terminal-activity": CustomEvent<void>;
    "opspad-terminal-flash": CustomEvent<void>;
  }
}

export function TerminalPane({ sessionId, sessionLabel, statusText, themeColor, environmentTag, connectionMeta }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Keep a stable base options object that never includes runtime-only fields like cols/rows.
  // Spreading `term.options` can include cols/rows and will crash when re-applied.
  const baseOptionsRef = useRef<Record<string, unknown> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  // Data can arrive before the UI has "attached" to a session. Buffer it so the
  // initial prompt isn't lost (otherwise the terminal can look dead).
  const pendingBySessionRef = useRef<Map<string, string>>(new Map());
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [banner, setBanner] = useState<{ text: string; kind: "ok" | "warn" } | null>(null);

  useLayoutEffect(() => {
    if (!hostRef.current || !mountRef.current) return;

    const baseOptions = {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      cursorBlink: true,
      lineHeight: 1.15,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: "#0b0f14",
        foreground: "#d8e1ee",
        cursor: "#d8e1ee",
        selectionBackground: "#1c2b3a",
      },
    };

    baseOptionsRef.current = baseOptions as unknown as Record<string, unknown>;

    const term = new Terminal(baseOptions);

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    // Layout isn't always stable on first paint; refit on the next frame.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      term.focus();
    });

    // Font loading can change cell metrics after the initial fit; refit once fonts are ready.
    // This prevents the last row from being partially clipped on some systems.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonts = (document as any).fonts as { ready?: Promise<void> } | undefined;
    fonts?.ready
      ?.then(() => {
        try {
          fit.fit();
        } catch {
          // ignore
        }
      })
      .catch(() => {});

    termRef.current = term;
    fitRef.current = fit;
    setReady(true);

    const hostEl = hostRef.current;
    const onMouseDown = () => term.focus();
    hostEl.addEventListener("mousedown", onMouseDown);

    const ro = new ResizeObserver(() => {
      const t = termRef.current;
      const f = fitRef.current;
      if (!t || !f) return;
      try {
        f.fit();
      } catch {
        return;
      }
      const sid = sessionIdRef.current;
      if (sid && t.cols > 1 && t.rows > 1) {
        void terminalResize(sid, t.cols, t.rows).catch((e) => {
          termRef.current?.writeln(`\r\n[opspad] resize failed: ${String(e)}\r\n`);
        });
      }
    });
    ro.observe(hostEl);

    return () => {
      ro.disconnect();
      hostEl.removeEventListener("mousedown", onMouseDown);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setReady(false);
    };
  }, []);

  const themeFor = (c: string | null | undefined) => {
    switch ((c ?? "").toLowerCase()) {
      case "red":
        return {
          background: "#12090b",
          foreground: "#f3e9eb",
          cursor: "#ffd0d0",
          selectionBackground: "#3a141a",
        };
      case "green":
        return {
          background: "#07120c",
          foreground: "#e6f6ee",
          cursor: "#baf7d4",
          selectionBackground: "#113225",
        };
      case "blue":
        return {
          background: "#07101a",
          foreground: "#e7f0ff",
          cursor: "#cfe2ff",
          selectionBackground: "#10253f",
        };
      case "teal":
        return {
          background: "#061214",
          foreground: "#e6f6f6",
          cursor: "#c7fbff",
          selectionBackground: "#10333a",
        };
      case "yellow":
        return {
          background: "#121006",
          foreground: "#fff7e0",
          cursor: "#ffe1a3",
          selectionBackground: "#3a2a12",
        };
      case "orange":
        return {
          background: "#120c06",
          foreground: "#fff0e6",
          cursor: "#ffd3b0",
          selectionBackground: "#3a1f12",
        };
      case "purple":
        return {
          background: "#0f0814",
          foreground: "#f4ecff",
          cursor: "#e4cfff",
          selectionBackground: "#2b123a",
        };
      case "pink":
        return {
          background: "#120812",
          foreground: "#ffeffa",
          cursor: "#ffd0ec",
          selectionBackground: "#3a1230",
        };
      case "gray":
        return {
          background: "#0b0f14",
          foreground: "#d8e1ee",
          cursor: "#d8e1ee",
          selectionBackground: "#1c2b3a",
        };
      default:
        return {
          background: "#0b0f14",
          foreground: "#d8e1ee",
          cursor: "#d8e1ee",
          selectionBackground: "#1c2b3a",
        };
    }
  };

  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    // xterm will throw if you attempt to set cols/rows via options after construction.
    // Never spread `t.options` here (it may include cols/rows). Re-apply our stable base options instead.
    const base = baseOptionsRef.current ?? {};
    t.options = { ...(base as Record<string, unknown>), theme: themeFor(themeColor) } as never;
    try {
      t.refresh(0, Math.max(0, t.rows - 1));
    } catch {
      // ignore
    }
  }, [themeColor]);

  useEffect(() => {
    if (!ready) return;

    let unlisten: (() => void) | null = null;
    (async () => {
      // Listen once for all terminal data and route it to the active session,
      // buffering anything that arrives early.
      unlisten = await listen<TerminalDataEvent>("terminal:data", (ev) => {
        const sid = ev.payload.sessionId;
        const activeSid = sessionIdRef.current;
        if (activeSid && sid === activeSid) {
          termRef.current?.write(ev.payload.data);
          return;
        }
        const prev = pendingBySessionRef.current.get(sid) ?? "";
        pendingBySessionRef.current.set(sid, prev + ev.payload.data);
      });
    })().catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    sessionIdRef.current = sessionId;
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;

    // Connection banners: lightweight, local-only UX feedback.
    if (prev !== sessionId) {
      if (!prev && sessionId) {
        const txt = connectionMeta ? `Connected. ${connectionMeta}` : "Connected.";
        setBanner({ text: txt, kind: "ok" });
        window.setTimeout(() => setBanner(null), 2200);
      } else if (prev && !sessionId) {
        setBanner({ text: "Disconnected.", kind: "warn" });
        window.setTimeout(() => setBanner(null), 2200);
      }
    }

    // Clear the visible buffer and show a small header.
    const term = termRef.current;
    if (term) {
      term.write("\x1bc");
      term.writeln("OpsPad");
      term.writeln(`Session: ${sessionLabel}`);
      term.writeln("");
      term.focus();
    }

    if (!sessionId) {
      termRef.current?.writeln(statusText ?? "No active session.");
      return;
    }

    let cleanupSession: (() => void) | null = null;

    (async () => {
      const disposable = termRef.current?.onData((data) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        window.dispatchEvent(new CustomEvent("opspad-terminal-activity"));
        void terminalWrite(sid, data).catch((e) => {
          termRef.current?.writeln(`\r\n[opspad] write failed: ${String(e)}\r\n`);
        });
      });

      const onPaste = (ev: CustomEvent<string>) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        const text = ev.detail ?? "";
        if (!text) return;
        void terminalWrite(sid, text).catch((e) => {
          termRef.current?.writeln(`\r\n[opspad] paste failed: ${String(e)}\r\n`);
        });
      };

      const onRun = (
        ev: CustomEvent<
          | string
          | {
              text: string;
              dockCommandId?: string;
              dockCommandTitle?: string;
              dockCommandTemplate?: string;
            }
        >,
      ) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        const d = ev.detail as unknown;
        const payload =
          typeof d === "string"
            ? { text: d }
            : d && typeof d === "object" && "text" in (d as Record<string, unknown>)
              ? (d as { text: string; dockCommandId?: string; dockCommandTitle?: string; dockCommandTemplate?: string })
              : { text: "" };

        const text = payload.text ?? "";
        if (!text) return;

        void terminalWrite(
          sid,
          text + "\r",
          "commanddock",
          {
            dockCommandId: payload.dockCommandId,
            dockCommandTitle: payload.dockCommandTitle,
            dockCommandTemplate: payload.dockCommandTemplate,
          },
        ).catch((e) => {
          termRef.current?.writeln(`\r\n[opspad] run failed: ${String(e)}\r\n`);
        });
        // Let CommandDock refresh history if it's open.
        window.dispatchEvent(new CustomEvent("opspad-history-updated"));
      };

      window.addEventListener("opspad-terminal-paste", onPaste as EventListener);
      window.addEventListener("opspad-terminal-run", onRun as EventListener);

      cleanupSession = () => {
        window.removeEventListener(
          "opspad-terminal-paste",
          onPaste as EventListener,
        );
        window.removeEventListener("opspad-terminal-run", onRun as EventListener);
        disposable?.dispose();
      };

      // Trigger one initial resize to sync PTY with current container.
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      const t = termRef.current;
      if (t && t.cols > 1 && t.rows > 1) {
        void terminalResize(sessionId, t.cols, t.rows).catch((e) => {
          termRef.current?.writeln(`\r\n[opspad] resize failed: ${String(e)}\r\n`);
        });
      }

      // Flush any buffered output that arrived before we attached.
      const pending = pendingBySessionRef.current.get(sessionId);
      if (pending) {
        pendingBySessionRef.current.delete(sessionId);
        termRef.current?.write(pending);
      }
    })().catch(() => {});

    return () => {
      if (cleanupSession) cleanupSession();
    };
  }, [ready, sessionId, sessionLabel, statusText]);

  useEffect(() => {
    const onFlash = () => {
      setFlash(true);
      try {
        termRef.current?.scrollToBottom();
      } catch {
        // ignore
      }
      window.setTimeout(() => setFlash(false), 260);
    };
    window.addEventListener("opspad-terminal-flash", onFlash as EventListener);
    return () => window.removeEventListener("opspad-terminal-flash", onFlash as EventListener);
  }, []);

  return (
    <div
      className={
        environmentTag && environmentTag.toUpperCase() !== "LOCAL"
          ? `terminalHost terminalAccent terminalAccent-${environmentTag.toUpperCase()} ${flash ? "terminalFlash" : ""} ${sessionId ? "" : "terminalDisconnected"}`
          : `terminalHost terminalAccent ${flash ? "terminalFlash" : ""} ${sessionId ? "" : "terminalDisconnected"}`
      }
      ref={hostRef}
    >
      {banner ? (
        <div className={banner.kind === "ok" ? "terminalBanner terminalBannerOk" : "terminalBanner terminalBannerWarn"}>
          {banner.text}
        </div>
      ) : null}
      {connectionMeta ? (
        <div className="terminalMeta" aria-label="Connection details">
          <div className="terminalMetaLeft">{connectionMeta}</div>
          <div className={sessionId ? "terminalMetaStatus terminalMetaStatusOn" : "terminalMetaStatus terminalMetaStatusOff"}>
            {sessionId ? "Connected" : "Disconnected"}
          </div>
        </div>
      ) : null}
      <div className="terminalMount" ref={mountRef} />
    </div>
  );
}
