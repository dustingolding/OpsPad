import { invoke } from "@tauri-apps/api/core";

function bytesToBase64(bytes: Uint8Array): string {
  // btoa operates on latin1. Convert bytes -> binary string first.
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function vaultSetSecret(key: string, secret: string): Promise<void> {
  const bytes = new TextEncoder().encode(secret);
  await invoke("vault_set_secret", { key, secretB64: bytesToBase64(bytes) });
}

export async function vaultGetSecret(key: string): Promise<string | null> {
  const b64 = await invoke<string | null>("vault_get_secret", { key });
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  return new TextDecoder().decode(bytes);
}

export async function vaultDeleteSecret(key: string): Promise<void> {
  await invoke("vault_delete_secret", { key });
}

export type Host = {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  environmentTag: string;
  identityFile?: string | null;
  color?: string | null;
};

export async function hostsList(): Promise<Host[]> {
  return invoke("hosts_list");
}

export async function hostsCreate(input: {
  label: string;
  hostname: string;
  port?: number | null;
  username: string;
  environmentTag: string;
  identityFile?: string | null;
  color?: string | null;
}): Promise<Host> {
  return invoke("hosts_create", {
    input: {
      label: input.label,
      hostname: input.hostname,
      port: input.port ?? null,
      username: input.username,
      environmentTag: input.environmentTag,
      identityFile: input.identityFile ?? null,
      color: input.color ?? null,
    },
  });
}

export async function hostsDelete(id: string): Promise<void> {
  await invoke("hosts_delete", { id });
}

export async function hostsUpdate(input: {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  environmentTag: string;
  identityFile?: string | null;
  color?: string | null;
}): Promise<Host> {
  return invoke("hosts_update", {
    input: {
      id: input.id,
      label: input.label,
      hostname: input.hostname,
      port: input.port,
      username: input.username,
      environmentTag: input.environmentTag,
      identityFile: input.identityFile ?? null,
      color: input.color ?? null,
    },
  });
}

export async function hostsReorder(ids: string[]): Promise<void> {
  await invoke("hosts_reorder", { ids });
}

export async function terminalOpenLocal(): Promise<string> {
  return invoke("terminal_open_local", { environmentTag: "LOCAL" });
}

export async function terminalOpenSsh(args: {
  user: string;
  host: string;
  hostId?: string | null;
  port?: number;
  identityFile?: string | null;
  extraArgs?: string[];
  environmentTag?: string | null;
}): Promise<string> {
  return invoke("terminal_open_ssh", {
    user: args.user,
    host: args.host,
    hostId: args.hostId ?? null,
    port: args.port ?? null,
    identityFile: args.identityFile ?? null,
    extraArgs: args.extraArgs ?? [],
    environmentTag: args.environmentTag ?? null,
  });
}

export async function terminalWrite(
  sessionId: string,
  data: string,
  origin?: string,
  meta?: {
    dockCommandId?: string;
    dockCommandTitle?: string;
    dockCommandTemplate?: string;
  },
): Promise<void> {
  // Keep payload minimal to avoid changing IPC args unless needed.
  const payload: Record<string, unknown> = { sessionId, data };
  if (origin) payload.origin = origin;
  if (meta?.dockCommandId) payload.dockCommandId = meta.dockCommandId;
  if (meta?.dockCommandTitle) payload.dockCommandTitle = meta.dockCommandTitle;
  if (meta?.dockCommandTemplate) payload.dockCommandTemplate = meta.dockCommandTemplate;
  await invoke("terminal_write", payload);
}

export async function terminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("terminal_resize", { sessionId, cols, rows });
}

export async function terminalClose(sessionId: string): Promise<void> {
  await invoke("terminal_close", { sessionId });
}

export async function terminalMarkExited(sessionId: string): Promise<void> {
  await invoke("terminal_mark_exited", { sessionId });
}

export type DockCommand = {
  id: string;
  title: string;
  command: string;
  requiresConfirm: boolean;
  color?: string | null;
};

export async function dockCommandsList(): Promise<DockCommand[]> {
  return invoke("dock_commands_list");
}

export async function dockCommandsCreate(input: {
  title: string;
  command: string;
  requiresConfirm?: boolean;
  color?: string | null;
}): Promise<DockCommand> {
  return invoke("dock_commands_create", {
    input: {
      title: input.title,
      command: input.command,
      requiresConfirm: input.requiresConfirm ?? false,
      color: input.color ?? null,
    },
  });
}

export async function dockCommandsUpdate(input: DockCommand): Promise<DockCommand> {
  return invoke("dock_commands_update", { input });
}

export async function dockCommandsDelete(id: string): Promise<void> {
  await invoke("dock_commands_delete", { id });
}

export async function dockCommandsReorder(ids: string[]): Promise<void> {
  await invoke("dock_commands_reorder", { ids });
}

export async function dockRunbookGet(): Promise<string> {
  return invoke("dock_runbook_get");
}

export async function dockRunbookSet(markdown: string): Promise<void> {
  await invoke("dock_runbook_set", { markdown });
}

export type DockHistoryItem = {
  id: string;
  createdAt: number;
  environmentTag: string;
  commandText: string;
};

export async function dockHistoryList(limit?: number): Promise<DockHistoryItem[]> {
  return invoke("dock_history_list", { limit: limit ?? null });
}

export async function dockHistoryDelete(id: string): Promise<void> {
  await invoke("dock_history_delete", { id });
}

export async function dockHistoryClear(): Promise<void> {
  await invoke("dock_history_clear");
}
