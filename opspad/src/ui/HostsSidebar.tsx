import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  hostsCreate,
  hostsDelete,
  hostsReorder,
  hostsList,
  hostsUpdate,
  vaultDeleteSecret,
  vaultGetSecret,
  vaultSetSecret,
} from "../lib/opspadApi";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { SelectMenu } from "./SelectMenu";

export type HostListItem = {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  environmentTag: string;
  identityFile?: string | null;
  color?: string | null;
};

function envClass(env: string) {
  switch (env) {
    case "PROD":
      return "pill pillProd";
    case "STAGE":
      return "pill pillStage";
    case "DEV":
      return "pill pillDev";
    default:
      return "pill pillLocal";
  }
}

export function HostsSidebar({
  onConnect,
  collapsed,
  onToggleCollapsed,
  activeHostId,
}: {
  onConnect: (host: HostListItem) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeHostId?: string | null;
}) {
  const [hosts, setHosts] = useState<HostListItem[]>([]);
  const [filter, setFilter] = useState("");
  const [manageMode, setManageMode] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number; host: HostListItem | null }>({
    open: false,
    x: 0,
    y: 0,
    host: null,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseRevealed, setPassphraseRevealed] = useState(false);
  const [form, setForm] = useState({
    label: "",
    hostname: "",
    port: "22",
    username: "ubuntu",
    environmentTag: "DEV",
    identityFile: "",
    color: "",
  });

  const passphraseKey = editingId ? `host:${editingId}:ssh_key_passphrase` : null;

  // On edit modal open: check whether a passphrase exists in keyring (do not reveal it).
  useEffect(() => {
    if (!modalOpen) return;
    if (modalMode !== "edit") return;
    if (!passphraseKey) return;

    let cancelled = false;
    setHasPassphrase(false);
    void vaultGetSecret(passphraseKey)
      .then((s) => {
        if (cancelled) return;
        setHasPassphrase(s != null && s.length > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setHasPassphrase(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modalOpen, modalMode, passphraseKey]);

  const refresh = async () => {
    const h = await hostsList();
    setHosts(h);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await hostsList();
        if (!cancelled) setHosts(h);
      } catch {
        if (!cancelled) setHosts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim();
    if (!q) return hosts;

    const tokens = q.split(/\s+/).filter(Boolean);
    const terms: { key?: string; value: string }[] = tokens.map((t) => {
      const idx = t.indexOf(":");
      if (idx > 0) return { key: t.slice(0, idx).toLowerCase(), value: t.slice(idx + 1) };
      return { value: t };
    });

    return hosts.filter((h) => {
      const env = h.environmentTag.toLowerCase();
      const label = h.label.toLowerCase();
      const host = h.hostname.toLowerCase();
      const user = h.username.toLowerCase();
      const port = String(h.port);
      const idf = (h.identityFile ?? "").toLowerCase();

      for (const term of terms) {
        const v = term.value.toLowerCase();
        if (!v) continue;
        switch (term.key) {
          case "tag":
          case "env":
            if (!env.includes(v)) return false;
            break;
          case "user":
            if (!user.includes(v)) return false;
            break;
          case "host":
            if (!host.includes(v)) return false;
            break;
          case "label":
            if (!label.includes(v)) return false;
            break;
          case "port":
            if (!port.includes(v)) return false;
            break;
          case "key":
          case "identity":
            if (!idf.includes(v)) return false;
            break;
          default: {
            const hay = `${label} ${user} ${host} ${port} ${env} ${idf}`;
            if (!hay.includes(v)) return false;
          }
        }
      }
      return true;
    });
  }, [hosts, filter]);

  const submitModal = async () => {
    setModalError(null);
    const label = form.label.trim();
    const hostname = form.hostname.trim();
    const username = form.username.trim();
    const environmentTag = form.environmentTag.trim().toUpperCase();
    const identityFile = form.identityFile.trim();
    const color = form.color.trim();

    if (!label) return setModalError("Label is required.");
    if (!hostname) return setModalError("Hostname is required.");
    if (!username) return setModalError("Username is required.");
    if (!environmentTag) return setModalError("Environment tag is required.");

    const portNum = Number(form.port);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      return setModalError("Port must be a number between 1 and 65535.");
    }

    setSaving(true);
    try {
      if (modalMode === "add") {
        await hostsCreate({
          label,
          hostname,
          port: portNum,
          username,
          environmentTag,
          identityFile: identityFile ? identityFile : null,
          color: color ? color : null,
        });
      } else {
        if (!editingId) throw new Error("No host selected for editing.");
        await hostsUpdate({
          id: editingId,
          label,
          hostname,
          port: portNum,
          username,
          environmentTag,
          identityFile: identityFile ? identityFile : null,
          color: color ? color : null,
        });
      }
      await refresh();
      setModalOpen(false);
      setForm({
        label: "",
        hostname: "",
        port: "22",
        username: "ubuntu",
        environmentTag: "DEV",
        identityFile: "",
        color: "",
      });
    } catch (e) {
      setModalError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (h: HostListItem) => {
    const ok = window.confirm(`Delete host "${h.label}" (${h.username}@${h.hostname})?`);
    if (!ok) return;
    try {
      await hostsDelete(h.id);
      // Best-effort cleanup of any host secrets.
      void vaultDeleteSecret(`host:${h.id}:ssh_key_passphrase`).catch(() => {});
      await refresh();
    } catch (e) {
      window.alert(`Failed to delete host: ${String(e)}`);
    }
  };

  const openAddModal = () => {
    setModalError(null);
    setModalMode("add");
    setEditingId(null);
    setHasPassphrase(false);
    setPassphrase("");
    setPassphraseRevealed(false);
    setForm({
      label: "",
      hostname: "",
      port: "22",
      username: "ubuntu",
      environmentTag: "DEV",
      identityFile: "",
      color: "",
    });
    setModalOpen(true);
  };

  const canReorder = !collapsed && filter.trim().length === 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const palette = [
    { id: "", label: "None" },
    { id: "teal", label: "Teal" },
    { id: "blue", label: "Blue" },
    { id: "green", label: "Green" },
    { id: "yellow", label: "Yellow" },
    { id: "orange", label: "Orange" },
    { id: "red", label: "Red" },
    { id: "purple", label: "Purple" },
    { id: "pink", label: "Pink" },
    { id: "gray", label: "Gray" },
  ];

  const envOptions = [
    { value: "DEV", label: "DEV" },
    { value: "STAGE", label: "STAGE" },
    { value: "PROD", label: "PROD" },
    { value: "LOCAL", label: "LOCAL" },
  ];

  const updateHostColor = async (h: HostListItem, color: string | null) => {
    try {
      await hostsUpdate({
        id: h.id,
        label: h.label,
        hostname: h.hostname,
        port: h.port,
        username: h.username,
        environmentTag: h.environmentTag,
        identityFile: h.identityFile ?? null,
        color,
      });
      await refresh();
    } catch (e) {
      window.alert(`Failed to update host: ${String(e)}`);
    }
  };

  const openEditModal = (h: HostListItem) => {
    setModalError(null);
    setModalMode("edit");
    setEditingId(h.id);
    setHasPassphrase(false);
    setPassphrase("");
    setPassphraseRevealed(false);
    setForm({
      label: h.label,
      hostname: h.hostname,
      port: String(h.port),
      username: h.username,
      environmentTag: h.environmentTag,
      identityFile: h.identityFile ?? "",
      color: h.color ?? "",
    });
    setModalOpen(true);
  };

  const ctxItems: ContextMenuItem[] = useMemo(() => {
    const h = ctxMenu.host;
    if (!h) return [];
    return [
      { label: "Connect", onClick: () => onConnect(h) },
      { label: "Edit", onClick: () => openEditModal(h) },
      { kind: "sep" },
      { kind: "header", label: "Color" },
      ...palette.map((p) => ({
        label: p.label,
        onClick: () => void updateHostColor(h, p.id ? p.id : null),
        disabled: (h.color ?? "") === p.id,
      })),
      { kind: "sep" },
      { label: "Delete", onClick: () => void doDelete(h) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxMenu.host?.id, ctxMenu.host?.color]);

  function HostRow({ h }: { h: HostListItem }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: h.id,
      disabled: !canReorder,
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.75 : 1,
    } as React.CSSProperties;

    const dotClass = h.color ? `colorDot colorDot-${h.color}` : "colorDot";
    const isActive = !!activeHostId && activeHostId === h.id;

    const envAmbientClass = `hostRowEnv-${h.environmentTag.trim().toUpperCase()}`;

    return (
      <div
        ref={setNodeRef}
        style={style}
        role="listitem"
        className={
          isActive
            ? `listRowWrap hostRow hostRowActive ${envAmbientClass}`
            : `listRowWrap hostRow ${envAmbientClass}`
        }
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ open: true, x: e.clientX, y: e.clientY, host: h });
        }}
      >
        {collapsed ? (
          <button
            className="listRow listRowButton hostRowButton hostRowButtonCollapsed"
            type="button"
            onClick={() => onConnect(h)}
            title={`${h.label} (${h.username}@${h.hostname}:${h.port})`}
            aria-label={`Connect to ${h.label}`}
            {...attributes}
            {...listeners}
          >
            <span className={dotClass} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="listRow listRowButton hostRowButton"
            type="button"
            onClick={() => onConnect(h)}
            title="Connect"
            {...attributes}
            {...listeners}
          >
            <span className={dotClass} aria-hidden="true" />
            <div className="listRowMain">
              <div className="listRowTitle">{h.label}</div>
              <div className="listRowSub">
                {h.username}@{h.hostname}:{h.port}
              </div>
            </div>
            <div className={envClass(h.environmentTag)}>{h.environmentTag}</div>
          </button>
        )}

        {manageMode ? (
          <button
            className="itemX itemXDanger"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void doDelete(h);
            }}
            title="Delete"
          >
            x
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className={collapsed ? "panel panelCollapsed" : "panel"}>
      <div className="panelHeader">
        {!collapsed ? <div className="panelTitle">Hosts</div> : <div className="panelTitle panelTitleHidden">Hosts</div>}
        <div className="panelHeaderActions">
          <button
            className={collapsed ? "miniButton miniButtonIconOnly" : "miniButton"}
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand hosts pane" : "Minimize hosts pane"}
          >
            <span className="hamburgerIcon" aria-hidden="true">
              <span className="hamburgerBar" />
              <span className="hamburgerBar" />
              <span className="hamburgerBar" />
            </span>
          </button>
        </div>
      </div>

      <div className="panelBody">
        {!collapsed ? (
          <label className="field">
            <span className="fieldLabel">Filter</span>
            <input
              className="textInput"
              placeholder="tag:prod user:root ..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        ) : null}

        <div className="list" role="list">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(ev: DragEndEvent) => {
              const { active, over } = ev;
              if (!canReorder) return;
              if (!over) return;
              if (active.id === over.id) return;
              const oldIndex = hosts.findIndex((h: HostListItem) => h.id === String(active.id));
              const newIndex = hosts.findIndex((h: HostListItem) => h.id === String(over.id));
              if (oldIndex < 0 || newIndex < 0) return;
              const next = arrayMove(hosts, oldIndex, newIndex);
              setHosts(next);
              void hostsReorder(next.map((h: HostListItem) => h.id)).catch(() => void refresh().catch(() => {}));
            }}
          >
            <SortableContext items={hosts.map((h) => h.id)} strategy={verticalListSortingStrategy}>
              {filtered.map((h) => (
                <HostRow key={h.id} h={h} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {!collapsed ? <div className="hint">Click a host to open an SSH session.</div> : null}

        {!collapsed ? (
          <div className="panelFab" aria-label="Hosts actions">
            <button className="fabButton" type="button" onClick={openAddModal} title="Add host">
              +
            </button>
            <button
              className={manageMode ? "fabButton fabButtonActive" : "fabButton"}
              type="button"
              onClick={() => setManageMode((v) => !v)}
              title={manageMode ? "Exit delete mode" : "Delete mode"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label={modalMode === "add" ? "Add host" : "Edit host"}
          >
            <div className="panelHeader">
              <div className="panelTitle">{modalMode === "add" ? "Add host" : "Edit host"}</div>
              <button className="miniButton" type="button" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="panelBody">
              <label className="field">
                <span className="fieldLabel">Label</span>
                <input
                  className="textInput"
                  value={form.label}
                  onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                  placeholder="prod-bastion"
                />
              </label>
              <label className="field">
                <span className="fieldLabel">Hostname</span>
                <input
                  className="textInput"
                  value={form.hostname}
                  onChange={(e) => setForm((p) => ({ ...p, hostname: e.target.value }))}
                  placeholder="10.0.0.10 or bastion.example.com"
                />
              </label>
              <label className="field">
                <span className="fieldLabel">Port</span>
                <input
                  className="textInput"
                  value={form.port}
                  onChange={(e) => setForm((p) => ({ ...p, port: e.target.value }))}
                  placeholder="22"
                />
              </label>
              <label className="field">
                <span className="fieldLabel">Username</span>
                <input
                  className="textInput"
                  value={form.username}
                  onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="ubuntu"
                />
              </label>
              <SelectMenu
                label="Environment"
                value={form.environmentTag}
                options={envOptions}
                onChange={(v) => setForm((p) => ({ ...p, environmentTag: v }))}
              />
              <label className="field">
                <span className="fieldLabel">Identity file (optional)</span>
                <input
                  className="textInput"
                  value={form.identityFile}
                  onChange={(e) => setForm((p) => ({ ...p, identityFile: e.target.value }))}
                  placeholder="C:\\Users\\you\\.ssh\\id_ed25519"
                />
              </label>
              <SelectMenu
                label="Color (optional)"
                value={form.color}
                options={palette.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => setForm((p) => ({ ...p, color: v }))}
              />

              {modalMode === "edit" ? (
                <div className="dockCard">
                  <div className="dockCardTitle">Credentials (OS keyring)</div>
                  <div className="hint">
                    SSH passphrase is stored in the OS keyring and never written to SQLite.
                    OpsPad does not inject passwords into `ssh` in the MVP.
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <span className="fieldLabel">
                      SSH key passphrase {hasPassphrase ? "(saved)" : "(not set)"}
                    </span>
                    <input
                      className="textInput"
                      type={passphraseRevealed ? "text" : "password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="(optional)"
                    />
                  </div>
                  <div className="formRow">
                    <button
                      className="miniButton"
                      type="button"
                      onClick={() => {
                        if (!passphraseKey) return;
                        setPassphraseRevealed((v) => !v);
                        if (!passphraseRevealed) {
                          // Reveal fetches the secret lazily.
                          void vaultGetSecret(passphraseKey)
                            .then((s) => {
                              if (s != null) {
                                setPassphrase(s);
                                setHasPassphrase(true);
                              }
                            })
                            .catch((e) => setModalError(String(e)));
                        }
                      }}
                    >
                      {passphraseRevealed ? "Hide" : "Reveal"}
                    </button>
                    <button
                      className="miniButton"
                      type="button"
                      onClick={() => {
                        if (!passphraseKey) return;
                        void vaultDeleteSecret(passphraseKey)
                          .then(() => {
                            setHasPassphrase(false);
                            setPassphrase("");
                            setPassphraseRevealed(false);
                          })
                          .catch((e) => setModalError(String(e)));
                      }}
                    >
                      Clear
                    </button>
                    <button
                      className="miniButton"
                      type="button"
                      onClick={() => {
                        if (!passphraseKey) return;
                        void vaultSetSecret(passphraseKey, passphrase)
                          .then(() => setHasPassphrase(true))
                          .catch((e) => setModalError(String(e)));
                      }}
                    >
                      Save passphrase
                    </button>
                  </div>
                </div>
              ) : null}

              {modalError ? <div className="formError">{modalError}</div> : null}

              <div className="formRow">
                <button className="miniButton" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className="miniButton"
                  type="button"
                  disabled={saving}
                  onClick={() => void submitModal()}
                >
                  {saving ? "Saving..." : modalMode === "add" ? "Create" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxItems}
        onClose={() => setCtxMenu({ open: false, x: 0, y: 0, host: null })}
      />
    </section>
  );
}
