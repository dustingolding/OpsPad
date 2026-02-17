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
  DockCommand,
  DockHistoryItem,
  dockCommandsCreate,
  dockCommandsDelete,
  dockCommandsList,
  dockCommandsReorder,
  dockCommandsUpdate,
  dockHistoryClear,
  dockHistoryDelete,
  dockHistoryList,
  dockRunbookGet,
  dockRunbookSet,
} from "../lib/opspadApi";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { SelectMenu } from "./SelectMenu";

type Mode = "view" | "new" | "edit" | "editRunbook" | "params" | "confirmDelete";
type ParamAction = "paste" | "run";
type DockTab = "commands" | "history";

function extractParams(template: string): string[] {
  const re = /\{([a-zA-Z0-9_:-]+)\}/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function substituteParams(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_:-]+)\}/g, (_, name: string) => values[name] ?? "");
}

function loadParamDefaults(commandId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`opspad.cmdparams.${commandId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveParamDefaults(commandId: string, values: Record<string, string>) {
  try {
    localStorage.setItem(`opspad.cmdparams.${commandId}`, JSON.stringify(values));
  } catch {
    // ignore
  }
}

export function CommandDock({ activeEnvironmentTag }: { activeEnvironmentTag: string }) {
  const [commands, setCommands] = useState<DockCommand[]>([]);
  const [runbook, setRunbook] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dockTab, setDockTab] = useState<DockTab>("commands");
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number; cmd: DockCommand | null }>({
    open: false,
    x: 0,
    y: 0,
    cmd: null,
  });

  const [draft, setDraft] = useState<{
    id?: string;
    title: string;
    command: string;
    requiresConfirm: boolean;
  }>({ title: "", command: "", requiresConfirm: false });
  const [deleteTarget, setDeleteTarget] = useState<DockCommand | null>(null);

  const [paramTarget, setParamTarget] = useState<{
    cmd: DockCommand;
    action: ParamAction;
    params: string[];
  } | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [pulseCmdId, setPulseCmdId] = useState<string | null>(null);
  useEffect(() => {
    if (!pulseCmdId) return;
    const t = window.setTimeout(() => setPulseCmdId(null), 420);
    return () => window.clearTimeout(t);
  }, [pulseCmdId]);
  useEffect(() => {
    if (mode !== "params") setParamTarget(null);
    if (mode !== "view") setManageMode(false);
  }, [mode]);

  const refresh = async () => {
    const [cmds, rb] = await Promise.all([dockCommandsList(), dockRunbookGet()]);
    setCommands(cmds);
    setRunbook(rb);
  };

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.title} ${c.command}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, search]);

  const [history, setHistory] = useState<DockHistoryItem[]>([]);
  const refreshHistory = async () => {
    const h = await dockHistoryList(200);
    setHistory(h);
  };

  useEffect(() => {
    if (dockTab !== "history") return;
    void refreshHistory().catch(() => {});
  }, [dockTab]);

  useEffect(() => {
    const onUpdated = () => {
      if (dockTab !== "history") return;
      void refreshHistory().catch(() => {});
    };
    window.addEventListener("opspad-history-updated", onUpdated as EventListener);
    return () => window.removeEventListener("opspad-history-updated", onUpdated as EventListener);
  }, [dockTab]);

  const paste = (
    text: string,
    opts?: {
      origin?: "commanddock" | "history";
      dockCommandId?: string;
      dockCommandTitle?: string;
      dockCommandTemplate?: string;
    },
  ) => {
    window.dispatchEvent(
      new CustomEvent("opspad-terminal-paste", {
        detail: {
          text,
          origin: opts?.origin,
          dockCommandId: opts?.dockCommandId,
          dockCommandTitle: opts?.dockCommandTitle,
          dockCommandTemplate: opts?.dockCommandTemplate,
        },
      }),
    );
  };

  const run = (cmd: DockCommand) => {
    const inProd = activeEnvironmentTag.toUpperCase() === "PROD";
    if (cmd.requiresConfirm || inProd) {
      const msg = cmd.requiresConfirm
        ? inProd
          ? "PROD: Run this command in the active terminal? (Confirm)"
          : "Run this command in the active terminal? (Confirm)"
        : "PROD: Run this command in the active terminal?";
      const ok = window.confirm(msg);
      if (!ok) return;
    }
    window.dispatchEvent(
      new CustomEvent("opspad-terminal-run", {
        detail: {
          text: cmd.command,
          dockCommandId: cmd.id,
          dockCommandTitle: cmd.title,
          dockCommandTemplate: cmd.command,
        },
      }),
    );
    // UX feedback: quick pulse around the terminal.
    window.dispatchEvent(new CustomEvent("opspad-terminal-flash"));
    setPulseCmdId(cmd.id);
  };

  const runOrParam = (cmd: DockCommand, action: ParamAction) => {
    const params = extractParams(cmd.command);
    if (params.length === 0) {
      if (action === "paste") {
        paste(cmd.command, {
          origin: "commanddock",
          dockCommandId: cmd.id,
          dockCommandTitle: cmd.title,
          dockCommandTemplate: cmd.command,
        });
        setPulseCmdId(cmd.id);
        window.dispatchEvent(new CustomEvent("opspad-terminal-flash"));
      }
      else run(cmd);
      return;
    }

    setError(null);
    setParamTarget({ cmd, action, params });
    const defaults = loadParamDefaults(cmd.id);
    const init: Record<string, string> = {};
    for (const p of params) init[p] = defaults[p] ?? "";
    setParamValues(init);
    setMode("params");
  };

  const openNew = () => {
    setError(null);
    setDraft({ title: "", command: "", requiresConfirm: false });
    setMode("new");
  };

  const openEdit = (cmd: DockCommand) => {
    setError(null);
    setDraft({
      id: cmd.id,
      title: cmd.title,
      command: cmd.command,
      requiresConfirm: cmd.requiresConfirm,
    });
    setMode("edit");
  };

  const saveDraft = async () => {
    setError(null);
    const title = draft.title.trim();
    const command = draft.command.trim();
    if (!title) return setError("Title is required.");
    if (!command) return setError("Command is required.");

    setSaving(true);
    try {
      if (mode === "new") {
        await dockCommandsCreate({
          title,
          command,
          requiresConfirm: draft.requiresConfirm,
        });
      } else if (mode === "edit") {
        if (!draft.id) throw new Error("Missing command id.");
        await dockCommandsUpdate({
          id: draft.id,
          title,
          command,
          requiresConfirm: draft.requiresConfirm,
        });
      }
      await refresh();
      setMode("view");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteCmd = (cmd: DockCommand) => {
    setError(null);
    setDeleteTarget(cmd);
    setMode("confirmDelete");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError(null);
    setSaving(true);
    try {
      await dockCommandsDelete(deleteTarget.id);
      await refresh();
      setDeleteTarget(null);
      setMode("view");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveRunbook = async () => {
    setError(null);
    setSaving(true);
    try {
      await dockRunbookSet(runbook);
      await refresh();
      setMode("view");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const showModal = mode !== "view";

  // In delete/manage mode we disable drag listeners so clicks on the delete button are reliable.
  const canReorder = search.trim().length === 0 && mode === "view" && !manageMode;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ctxItems: ContextMenuItem[] = useMemo(() => {
    const cmd = ctxMenu.cmd;
    if (!cmd) return [];
    const items: ContextMenuItem[] = [
      { label: "Run", onClick: () => runOrParam(cmd, "run") },
      { label: "Paste", onClick: () => runOrParam(cmd, "paste") },
      { kind: "sep" },
      { label: "Copy", onClick: () => void navigator.clipboard?.writeText(cmd.command).catch(() => {}) },
      { label: "Edit", onClick: () => openEdit(cmd) },
      { kind: "sep" },
      { label: "Delete", onClick: () => void deleteCmd(cmd) },
    ];
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxMenu.cmd?.id]);

  function CmdRow({ c }: { c: DockCommand }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: c.id,
      disabled: !canReorder,
    });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.75 : 1,
    } as React.CSSProperties;

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={pulseCmdId === c.id ? "dockRow dockRowPulse" : "dockRow"}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ open: true, x: e.clientX, y: e.clientY, cmd: c });
        }}
        {...(canReorder ? attributes : {})}
        {...(canReorder ? listeners : {})}
        title={canReorder ? "Drag to reorder" : undefined}
      >
        <div className="dockRowText">
          <div className="dockRowTitle">
            {c.title}
            {c.requiresConfirm ? <span className="pill pillWarn">Confirm</span> : null}
          </div>
          <div className="dockRowCmd">{c.command}</div>
        </div>
        <div className="dockRowActions">
          <button
            className="miniButton miniButtonGhost"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              runOrParam(c, "paste");
            }}
          >
            Paste
          </button>
          <button
            className="miniButton miniButtonGhost"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              runOrParam(c, "run");
            }}
          >
            Run
          </button>
          {manageMode ? (
            <button
              className="itemX itemXDanger"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void deleteCmd(c);
              }}
              title="Delete"
            >
              x
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">CommandDock</div>
        <div className="panelHeaderActions">
          <button
            className={dockTab === "commands" ? "miniButton miniButtonActive" : "miniButton"}
            type="button"
            onClick={() => setDockTab("commands")}
            title="Commands"
          >
            Commands
          </button>
          <button
            className={dockTab === "history" ? "miniButton miniButtonActive" : "miniButton"}
            type="button"
            onClick={() => setDockTab("history")}
            title="History"
          >
            History
          </button>
        </div>
      </div>

      <div className="panelBody">
        <label className="field">
          <span className="fieldLabel">Search</span>
          <input
            className="textInput"
            placeholder={dockTab === "history" ? "search history..." : "kubectl, nginx, deploy..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {dockTab === "commands" ? (
          <div className="dockCard">
            <div className="dockCardTitleRow">
              <div className="dockCardTitle">Runbook</div>
              <button className="miniButton miniButtonGhost" type="button" onClick={() => setMode("editRunbook")}>
                Edit
              </button>
            </div>
            <div className="dockMarkdown">
              <pre>{runbook}</pre>
            </div>
          </div>
        ) : null}

        {dockTab === "commands" ? (
          <div className="dockCard">
            <div className="dockCardTitle">Commands</div>
            <div className="dockList">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(ev: DragEndEvent) => {
                  if (!canReorder) return;
                  const { active, over } = ev;
                  if (!over) return;
                  if (active.id === over.id) return;
                  const oldIndex = commands.findIndex((c) => c.id === String(active.id));
                  const newIndex = commands.findIndex((c) => c.id === String(over.id));
                  if (oldIndex < 0 || newIndex < 0) return;
                  const next = arrayMove(commands, oldIndex, newIndex);
                  setCommands(next);
                  void dockCommandsReorder(next.map((c) => c.id)).catch(() => void refresh().catch(() => {}));
                }}
              >
                <SortableContext items={commands.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {filtered.map((c) => (
                    <CmdRow key={c.id} c={c} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        ) : (
          <div className="dockCard">
            <div className="dockCardTitleRow">
              <div className="dockCardTitle">History</div>
              <button
                className="miniButton miniButtonGhost"
                type="button"
                onClick={() => {
                  const ok = window.confirm("Clear command history?");
                  if (!ok) return;
                  void dockHistoryClear().then(refreshHistory).catch((e) => setError(String(e)));
                }}
              >
                Clear
              </button>
            </div>
            <div className="dockList">
              {(history.filter((h) => {
                const q = search.trim().toLowerCase();
                if (!q) return true;
                return h.commandText.toLowerCase().includes(q);
              })).map((h) => (
                <div key={h.id} className="dockRow dockRowHistory">
                  <div className="dockRowText">
                    <div className="dockRowTitle">
                      <span className="pill pillLocal">{h.environmentTag}</span>
                      <span style={{ opacity: 0.9 }}>Ran</span>
                    </div>
                    <div className="dockRowCmd">{h.commandText}</div>
                  </div>
                  <div className="dockRowActions">
                    <button
                      className="miniButton miniButtonGhost"
                      type="button"
                      onClick={() => paste(h.commandText, { origin: "history" })}
                    >
                      Paste
                    </button>
                    <button
                      className="miniButton miniButtonGhost"
                      type="button"
                      onClick={() => {
                        const title = window.prompt("Save as CommandDock command title:", "Saved command");
                        if (!title) return;
                        void dockCommandsCreate({ title, command: h.commandText }).then(refresh).catch((e) => setError(String(e)));
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="itemX itemXDanger"
                      type="button"
                      title="Delete"
                      onClick={() => void dockHistoryDelete(h.id).then(refreshHistory).catch((e) => setError(String(e)))}
                    >
                      x
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error ? <div className="formError">{error}</div> : null}

        <div className="hint">Paste/Run targets the active terminal tab.</div>

        <div className="panelFab" aria-label="CommandDock actions">
          <button
            className="fabButton"
            type="button"
            onClick={() => {
              if (dockTab === "history") return;
              openNew();
            }}
            title={dockTab === "history" ? "Switch to Commands to add" : "New command"}
            disabled={dockTab === "history"}
          >
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
      </div>

      {showModal ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMode("view");
          }}
        >
          <div className="modalCard" role="dialog" aria-modal="true" aria-label="CommandDock editor">
            <div className="panelHeader">
              <div className="panelTitle">
                {mode === "params"
                  ? "Fill parameters"
                  : mode === "confirmDelete"
                    ? "Delete command"
                  : mode === "editRunbook"
                    ? "Edit runbook"
                    : mode === "edit"
                      ? "Edit command"
                      : "New command"}
              </div>
              <button className="miniButton" type="button" onClick={() => setMode("view")}>
                Close
              </button>
            </div>
            <div className="panelBody">
              {mode === "confirmDelete" ? (
                <>
                  <div className="hint" style={{ marginTop: 0 }}>
                    {deleteTarget ? `Delete "${deleteTarget.title}"?` : "Delete this command?"}
                  </div>
                  <div className="hint">
                    This removes it from CommandDock. (History entries are separate.)
                  </div>
                </>
              ) : mode === "params" && paramTarget ? (
                <>
                  <div className="hint" style={{ marginTop: 0 }}>
                    {paramTarget.cmd.title}
                  </div>
                  {paramTarget.params.map((p) => (
                    <label key={p} className="field">
                      <span className="fieldLabel">{p}</span>
                      <input
                        className="textInput"
                        value={paramValues[p] ?? ""}
                        onChange={(e) =>
                          setParamValues((prev) => ({
                            ...prev,
                            [p]: e.target.value,
                          }))
                        }
                        placeholder={`{${p}}`}
                      />
                    </label>
                  ))}
                </>
              ) : mode === "editRunbook" ? (
                <label className="field">
                  <span className="fieldLabel">Markdown</span>
                  <textarea
                    className="textInput"
                    style={{ height: 240, paddingTop: 10, paddingBottom: 10, resize: "vertical" }}
                    value={runbook}
                    onChange={(e) => setRunbook(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span className="fieldLabel">Title</span>
                    <input
                      className="textInput"
                      value={draft.title}
                      onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                      placeholder="List pods"
                    />
                  </label>
                  <label className="field">
                    <span className="fieldLabel">Command</span>
                    <textarea
                      className="textInput"
                      style={{ height: 120, paddingTop: 10, paddingBottom: 10, resize: "vertical" }}
                      value={draft.command}
                      onChange={(e) => setDraft((p) => ({ ...p, command: e.target.value }))}
                      placeholder="kubectl get pods -n {ns}"
                    />
                  </label>
                  <SelectMenu
                    label="Requires confirm"
                    value={draft.requiresConfirm ? "yes" : "no"}
                    options={[
                      { value: "no", label: "No" },
                      { value: "yes", label: "Yes" },
                    ]}
                    onChange={(v) => setDraft((p) => ({ ...p, requiresConfirm: v === "yes" }))}
                  />
                </>
              )}

              {error ? <div className="formError">{error}</div> : null}

              <div className="formRow">
                <button className="miniButton" type="button" onClick={() => setMode("view")}>
                  Cancel
                </button>
                <button
                  className="miniButton"
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void (mode === "params"
                      ? (async () => {
                          if (!paramTarget) return;
                          setError(null);
                          for (const p of paramTarget.params) {
                            const v = (paramValues[p] ?? "").trim();
                            if (!v) {
                              setError(`Missing value for "${p}".`);
                              return;
                            }
                          }
                          saveParamDefaults(paramTarget.cmd.id, paramValues);
                          const finalCmd = substituteParams(paramTarget.cmd.command, paramValues);
                          if (paramTarget.action === "run") {
                            const inProd = activeEnvironmentTag.toUpperCase() === "PROD";
                            if (paramTarget.cmd.requiresConfirm || inProd) {
                              const msg = paramTarget.cmd.requiresConfirm
                                ? inProd
                                  ? "PROD: Run this command in the active terminal? (Confirm)"
                                  : "Run this command in the active terminal? (Confirm)"
                                : "PROD: Run this command in the active terminal?";
                              const ok = window.confirm(msg);
                              if (!ok) return;
                            }
                            window.dispatchEvent(
                              new CustomEvent("opspad-terminal-run", {
                                detail: {
                                  text: finalCmd,
                                  dockCommandId: paramTarget.cmd.id,
                                  dockCommandTitle: paramTarget.cmd.title,
                                  dockCommandTemplate: paramTarget.cmd.command,
                                },
                              }),
                            );
                          } else {
                            paste(finalCmd, {
                              origin: "commanddock",
                              dockCommandId: paramTarget.cmd.id,
                              dockCommandTitle: paramTarget.cmd.title,
                              dockCommandTemplate: paramTarget.cmd.command,
                            });
                          }
                          setParamTarget(null);
                          setMode("view");
                        })()
                      : mode === "confirmDelete"
                        ? confirmDelete()
                      : mode === "editRunbook"
                        ? saveRunbook()
                        : saveDraft())}
                >
                  {saving
                    ? "Working..."
                    : mode === "confirmDelete"
                      ? "Delete"
                      : "Save"}
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
        onClose={() => setCtxMenu({ open: false, x: 0, y: 0, cmd: null })}
      />
    </section>
  );
}
