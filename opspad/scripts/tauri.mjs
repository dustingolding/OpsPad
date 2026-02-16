import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function quoteForCmd(s) {
  // Minimal cmd.exe quoting.
  if (!s.includes(" ")) return s;
  return `"${s}"`;
}

function findVsDevCmd() {
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (existsSync(vswhere)) {
    // Use vswhere to find an install with VC tools. We avoid requiring PowerShell here.
    // `-property productPath` returns something like ...\Common7\Tools\LaunchDevCmd.bat
    // We can derive VsDevCmd.bat from the installation path as a stable location.
    return { vswhere };
  }

  return { vswhere: null };
}

async function main() {
  const args = process.argv.slice(2);

  // Resolve tauri CLI from local deps (works on all platforms).
  const tauriBin = path.join("node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
  if (!existsSync(tauriBin)) {
    console.error(`Tauri CLI not found at ${tauriBin}. Did you run pnpm install?`);
    process.exit(1);
  }

  if (process.platform !== "win32") {
    await run(tauriBin, args, { shell: false });
    return;
  }

  // On Windows, rustc needs MSVC environment variables for linking.
  const { vswhere } = findVsDevCmd();
  let vsDevCmd = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat";

  if (vswhere && existsSync(vswhere)) {
    // Ask vswhere for the installation path that contains VC tools.
    // Use `cmd.exe` to keep escaping predictable.
    // If this fails, we fall back to the default BuildTools path above.
    const query =
      `${quoteForCmd(vswhere)} -products * ` +
      `-requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ` +
      `-property installationPath`;

    const out = await new Promise((resolve) => {
      const child = spawn("cmd.exe", ["/d", "/s", "/c", query], { stdio: ["ignore", "pipe", "ignore"] });
      let buf = "";
      child.stdout.on("data", (d) => (buf += d.toString("utf8")));
      child.on("close", () => resolve(buf.trim()));
      child.on("error", () => resolve(""));
    });

    if (out) {
      const candidate = path.join(out, "Common7", "Tools", "VsDevCmd.bat");
      if (existsSync(candidate)) vsDevCmd = candidate;
    }
  }

  if (!existsSync(vsDevCmd)) {
    console.error(`VsDevCmd.bat not found at: ${vsDevCmd}`);
    console.error("Install Visual Studio Build Tools with the 'Desktop development with C++' workload.");
    process.exit(1);
  }

  // Load MSVC env vars into this process, then run the tauri CLI with that env.
  const vsEnv = await new Promise((resolve) => {
    const cmd =
      `call ${quoteForCmd(vsDevCmd)} -arch=x64 -host_arch=x64 >nul` +
      " && set";
    const child = spawn("cmd.exe", ["/d", "/s", "/c", cmd], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (d) => (buf += d.toString("utf8")));
    child.on("close", () => {
      const env = {};
      for (const rawLine of buf.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const k = line.slice(0, eq);
        const v = line.slice(eq + 1);
        env[k] = v;
      }
      resolve(env);
    });
    child.on("error", () => resolve({}));
  });

  const env = { ...process.env, ...vsEnv };
  const userprofile = env.USERPROFILE ?? process.env.USERPROFILE ?? "";
  const appdata = env.APPDATA ?? process.env.APPDATA ?? "";
  const basePath = env.PATH ?? process.env.PATH ?? "";
  env.PATH = `${userprofile}\\.cargo\\bin;C:\\Program Files\\nodejs;${appdata}\\npm;${basePath}`;

  const tauriCmd = `${quoteForCmd(path.resolve(tauriBin))} ${args.map(quoteForCmd).join(" ")}`.trim();
  await run("cmd.exe", ["/d", "/s", "/c", tauriCmd], { shell: false, env });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
