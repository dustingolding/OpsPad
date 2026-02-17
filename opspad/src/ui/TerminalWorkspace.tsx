import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { HostListItem } from "./HostsSidebar";
import { terminalClose, terminalMarkExited, terminalOpenLocal, terminalOpenSsh } from "../lib/opspadApi";
import { TerminalPane } from "./TerminalPane";

type ConnectRequest = {
  host: HostListItem;
  nonce: string;
};

type SshMeta = {
  hostId: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  environmentTag: string;
  identityFile?: string | null;
  color?: string | null;
};

type TermTab = {
  id: string;
  kind: "local" | "ssh";
  title: string;
  sessionId: string | null;
  statusText?: string | null;
  ssh?: SshMeta;
  bornAt: number;
};

function newId(prefix: string) {
  const u =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${u}`;
}

function kindLabel(kind: "local" | "ssh") {
  // Avoid calling local tabs "Local" everywhere; from the user's POV these are just terminals.
  return kind === "ssh" ? "SSH" : "TERM";
}

function statusKind(t: TermTab): "connected" | "connecting" | "disconnected" | "error" {
  const st = (t.statusText ?? "").toLowerCase();
  if (st.includes("failed") || st.includes("error")) return "error";
  if (st.includes("connecting") || st.includes("starting") || st.includes("reconnecting")) return "connecting";
  if (t.sessionId) return "connected";
  if (t.kind === "ssh") return "disconnected";
  return "connected";
}

export function TerminalWorkspace({
  connectRequest,
  onContextChange,
}: {
  connectRequest: ConnectRequest | null;
  onContextChange?: (ctx: {
    kind: "local" | "ssh";
    environmentTag: string;
    hostId?: string | null;
    connected?: boolean;
  }) => void;
}) {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const tabsRef = useRef<TermTab[]>([]);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    tabsRef.current = tabs;
    activeIdRef.current = activeId;
  }, [tabs, activeId]);

  const activeTab = useMemo(() => {
    if (!activeId) return tabs[0] ?? null;
    return tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  }, [tabs, activeId]);

  useEffect(() => {
    if (!onContextChange) return;
    if (!activeTab) return;
    if (activeTab.kind === "ssh" && activeTab.ssh) {
      onContextChange({
        kind: "ssh",
        environmentTag: activeTab.ssh.environmentTag,
        hostId: activeTab.ssh.hostId,
        connected: !!activeTab.sessionId,
      });
    } else {
      onContextChange({ kind: "local", environmentTag: "LOCAL", hostId: null, connected: !!activeTab.sessionId });
    }
  }, [activeTab?.id, activeTab?.kind, activeTab?.ssh?.environmentTag, onContextChange]);

  const pickLocalTabId = (tabsIn: TermTab[]) => tabsIn.find((t) => t.kind === "local")?.id ?? null;

  const setActiveLocal = () => {
    const localId = pickLocalTabId(tabsRef.current);
    if (localId) setActiveId(localId);
  };

  const closeTab = (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.sessionId) void terminalClose(tab.sessionId).catch(() => {});

    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeIdRef.current === tabId) {
      // Prefer any remaining local session, else fall back to the first remaining tab.
      setTimeout(() => {
        const nextLocal = pickLocalTabId(tabsRef.current.filter((t) => t.id !== tabId));
        if (nextLocal) setActiveId(nextLocal);
        else {
          const remaining = tabsRef.current.filter((t) => t.id !== tabId);
          setActiveId(remaining[0]?.id ?? null);
        }
      }, 0);
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function TabButton({ t }: { t: TermTab }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.75 : 1,
    } as React.CSSProperties;

    const isNew = Date.now() - t.bornAt < 500;
    const sk = statusKind(t);

    return (
      <button
        ref={setNodeRef}
        style={style}
        className={
          t.id === activeTab.id
            ? `tab tabActive ${isNew ? "tabEnter" : ""}`
            : `tab ${isNew ? "tabEnter" : ""}`
        }
        type="button"
        aria-selected={t.id === activeTab.id}
        onClick={() => setActiveId(t.id)}
        title={t.kind === "ssh" && t.ssh ? `${t.ssh.username}@${t.ssh.hostname}` : t.title}
        {...attributes}
        {...listeners}
      >
        <span className={`tabStatus tabStatus-${sk}`} aria-hidden="true" />
        <span className="tabTitle">{t.title}</span>
        <span className={t.kind === "ssh" ? "pill pillStage" : "pill pillLocal"}>{kindLabel(t.kind)}</span>
        <span
          className="tabClose"
          role="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeTab(t.id);
          }}
        >
          x
        </span>
      </button>
    );
  }

  const openLocalTab = async () => {
    const tabId = newId("local");
    const localCount = tabsRef.current.filter((t) => t.kind === "local").length;
    const title = localCount === 0 ? "OpsPad" : `OpsPad ${localCount + 1}`;
    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        kind: "local",
        title,
        sessionId: null,
        statusText: "Starting local shell...",
        bornAt: Date.now(),
      },
    ]);
    setActiveId(tabId);

    try {
      const sid = await terminalOpenLocal();
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, sessionId: sid, statusText: null } : t)));
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, sessionId: null, statusText: `Failed to start local shell: ${String(e)}` } : t,
        ),
      );
    }
  };

  const connectOrActivateSsh = async (host: HostListItem) => {
    const existing = tabsRef.current.find((t) => t.kind === "ssh" && t.ssh?.hostId === host.id);
    if (existing) {
      setActiveId(existing.id);
      // If it ended earlier, reconnect in-place.
      if (!existing.sessionId) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === existing.id ? { ...t, statusText: `Reconnecting to ${host.username}@${host.hostname}...` } : t,
          ),
        );
        try {
          const sid = await terminalOpenSsh({
            user: host.username,
            host: host.hostname,
            hostId: host.id,
            port: host.port,
            identityFile: host.identityFile ?? null,
            extraArgs: [],
            environmentTag: host.environmentTag,
          });
          setTabs((prev) => prev.map((t) => (t.id === existing.id ? { ...t, sessionId: sid, statusText: null } : t)));
        } catch (e) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === existing.id ? { ...t, sessionId: null, statusText: `SSH connect failed: ${String(e)}` } : t,
            ),
          );
        }
      }
      return;
    }

    const tabId = newId("ssh");
    const meta: SshMeta = {
      hostId: host.id,
      label: host.label,
      hostname: host.hostname,
      port: host.port,
      username: host.username,
      environmentTag: host.environmentTag,
      identityFile: host.identityFile ?? null,
      color: host.color ?? null,
    };

    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        kind: "ssh",
        title: host.label,
        sessionId: null,
        statusText: `Connecting to ${host.username}@${host.hostname}...`,
        ssh: meta,
        bornAt: Date.now(),
      },
    ]);
    setActiveId(tabId);

    try {
      const sid = await terminalOpenSsh({
        user: host.username,
        host: host.hostname,
        hostId: host.id,
        port: host.port,
        identityFile: host.identityFile ?? null,
        extraArgs: [],
        environmentTag: host.environmentTag,
      });
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, sessionId: sid, statusText: null } : t)));
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, sessionId: null, statusText: `SSH connect failed: ${String(e)}` } : t,
        ),
      );
    }
  };

  // Ensure there's always at least one local tab.
  useEffect(() => {
    if (tabs.length > 0) return;
    void openLocalTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  // Host click connects/activates a tab (does not reconnect on tab switch).
  useEffect(() => {
    if (!connectRequest) return;
    void connectOrActivateSsh(connectRequest.host);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectRequest?.nonce]);

  // Process exits: close SSH tabs and return focus to a local tab.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<{ sessionId: string }>("terminal:exit", (ev) => {
        const sid = ev.payload.sessionId;
        void terminalMarkExited(sid).catch(() => {});
        const tab = tabsRef.current.find((t) => t.sessionId === sid);
        if (!tab) return;

        if (tab.kind === "ssh") {
          // Mark disconnected and bounce back to local.
          // Keep the tab around so users can keep it in their workspace and reconnect via host click.
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tab.id ? { ...t, sessionId: null, statusText: "Disconnected." } : t,
            ),
          );
          setTimeout(() => setActiveLocal(), 0);
          return;
        }

        // Local shell ended: keep the tab but mark it inactive.
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, sessionId: null, statusText: "Local session ended. Open a new terminal." } : t,
          ),
        );
      });
    })().catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  if (!activeTab) {
    return (
      <section className="panel panelFlush">
        <div className="tabBar" role="tablist" aria-label="Terminal tabs">
          <div className="tabBarSpacer" />
          <button className="miniButton" type="button" onClick={() => void openLocalTab()} title="New terminal">
            +
          </button>
        </div>
        <div className="terminalFrame">
          <div className="hint">No terminals open.</div>
        </div>
      </section>
    );
  }

  const panePropsFor = (t: TermTab) => {
    const sessionLabel =
      t.kind === "ssh" && t.ssh
        ? `SSH ${t.ssh.username}@${t.ssh.hostname}`
        : t.title;
    const environmentTag = t.kind === "ssh" ? t.ssh?.environmentTag ?? "UNKNOWN" : "LOCAL";
    const connectionMeta =
      t.kind === "ssh" && t.ssh
        ? `Connected to: ${t.ssh.label}  ·  ${t.ssh.environmentTag}  ·  ${t.ssh.hostname}:${t.ssh.port}`
        : null;
    return { sessionLabel, environmentTag, connectionMeta };
  };

  return (
    <section className="panel panelFlush">
      <div className="tabBar" role="tablist" aria-label="Terminal tabs">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(ev: DragEndEvent) => {
            const { active, over } = ev;
            if (!over) return;
            if (active.id === over.id) return;
            const oldIndex = tabs.findIndex((t) => t.id === String(active.id));
            const newIndex = tabs.findIndex((t) => t.id === String(over.id));
            if (oldIndex < 0 || newIndex < 0) return;
            setTabs((prev) => arrayMove(prev, oldIndex, newIndex));
          }}
        >
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((t) => (
              <TabButton key={t.id} t={t} />
            ))}
          </SortableContext>
        </DndContext>
        <div className="tabBarSpacer" />
        <button className="miniButton" type="button" onClick={() => void openLocalTab()} title="New terminal">
          +
        </button>
      </div>

      <div className="terminalFrame">
        {tabs.map((t) => {
          const { sessionLabel, environmentTag, connectionMeta } = panePropsFor(t);
          const isActive = t.id === activeTab.id;
          return (
            <div key={t.id} style={{ display: isActive ? "block" : "none", height: "100%" }}>
              <TerminalPane
                active={isActive}
                sessionId={t.sessionId}
                statusText={t.statusText}
                sessionLabel={sessionLabel}
                themeColor={null}
                environmentTag={environmentTag}
                connectionMeta={connectionMeta}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
