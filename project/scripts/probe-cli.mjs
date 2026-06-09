#!/usr/bin/env node
// Probe how each local AI CLI behaves in NON-INTERACTIVE (headless) mode —
// exactly how GameAIStudio drives it — so we can see why the app gets no model
// output even though the interactive CLI works.
//
// Usage:
//   node scripts/probe-cli.mjs            # probe all
//   node scripts/probe-cli.mjs claude     # probe one
//
// For each CLI it tries several invocation strategies (prompt via stdin vs.
// prompt as an argument) and prints command / exitCode / stdout / stderr so you
// can tell which one actually makes the model respond on THIS machine.

import { spawn, spawnSync } from "node:child_process";

const PROMPT = "你好，请用一句话回答：你是什么模型？";
const TIMEOUT_MS = 90_000;

const isWin = process.platform === "win32";

function isWindowsCommandShim(command) {
  return isWin && /\.(?:cmd|bat)$/i.test(command);
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/\r\n?|\n/g, " ").replace(/"/g, '""')}"`;
}

// Mirrors packages/main/src/services/process-runner.ts buildProcessLaunch.
function buildLaunch(command, args) {
  if (!isWindowsCommandShim(command)) {
    return { command, args, verbatim: false };
  }
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe";
  const line = `"${[command, ...args].map(quoteCmdArg).join(" ")}"`;
  return { command: comspec, args: ["/d", "/v:off", "/c", line], verbatim: true };
}

function which(cmd) {
  const r = spawnSync(isWin ? "where.exe" : "which", [cmd], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!isWin) return lines[0];
  return lines.find((l) => /\.(?:cmd|exe|bat|com)$/i.test(l)) ?? lines[0];
}

function run(command, args, stdin) {
  return new Promise((resolve) => {
    const launch = buildLaunch(command, args);
    const start = Date.now();
    let child;
    try {
      child = spawn(launch.command, launch.args, {
        windowsHide: true,
        windowsVerbatimArguments: launch.verbatim,
        env: process.env,
      });
    } catch (e) {
      resolve({ code: null, out: "", err: String(e), ms: Date.now() - start });
      return;
    }
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, ms: Date.now() - start });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out, err: err + "\n" + String(e), ms: Date.now() - start });
    });
  });
}

// Per-CLI invocation strategies. `stdin: true` pipes the prompt; otherwise the
// prompt is appended as the final argument.
const CLIS = {
  codex: {
    command: "codex",
    strategies: [
      { label: "app 现用: exec --skip-git-repo-check - (stdin)", args: ["exec", "--skip-git-repo-check", "-"], stdin: true },
      { label: "prompt 作参数: exec --skip-git-repo-check <prompt>", args: ["exec", "--skip-git-repo-check"], stdin: false },
      { label: "prompt 作参数(无 -): exec <prompt>", args: ["exec"], stdin: false },
    ],
  },
  claude: {
    command: "claude",
    strategies: [
      { label: "app 现用: --print (stdin)", args: ["--print"], stdin: true },
      { label: "prompt 作参数: --print <prompt>", args: ["--print"], stdin: false },
      { label: "prompt 作参数: -p <prompt>", args: ["-p"], stdin: false },
    ],
  },
  kscc: {
    command: "kscc",
    strategies: [
      { label: "app 现用: --print (stdin)", args: ["--print"], stdin: true },
      { label: "prompt 作参数: --print <prompt>", args: ["--print"], stdin: false },
      { label: "prompt 作参数: -p <prompt>", args: ["-p"], stdin: false },
    ],
  },
  kimi: {
    command: "kimi",
    strategies: [
      { label: "app 现用: --print (stdin)", args: ["--print"], stdin: true },
      { label: "prompt 作参数: --print <prompt>", args: ["--print"], stdin: false },
      { label: "prompt 作参数: -p <prompt>", args: ["-p"], stdin: false },
    ],
  },
};

const clip = (s, n = 600) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}\n…(截断 ${t.length - n} 字符)` : t;
};

async function probe(name) {
  const def = CLIS[name];
  if (!def) {
    console.log(`未知 CLI：${name}`);
    return;
  }
  console.log(`\n${"=".repeat(72)}\n# ${name}\n${"=".repeat(72)}`);
  const exe = which(def.command);
  if (!exe) {
    console.log(`✗ 未找到 ${def.command}（where/which 未命中）。跳过。`);
    return;
  }
  console.log(`解析路径: ${exe}`);

  for (const s of def.strategies) {
    const args = s.stdin ? s.args : [...s.args, PROMPT];
    const launch = buildLaunch(exe, args);
    console.log(`\n— 策略: ${s.label}`);
    console.log(`  spawn: ${launch.command} ${launch.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    if (s.stdin) console.log(`  stdin: <prompt>`);
    const r = await run(exe, args, s.stdin ? PROMPT : undefined);
    const verdict =
      r.code === 0 && r.out.trim()
        ? "✓ 有输出"
        : r.code === 0
          ? "△ exit 0 但无 stdout（= app 里的“无反馈”）"
          : `✗ exit ${r.code}`;
    console.log(`  结果: ${verdict} · ${r.ms}ms`);
    if (r.out.trim()) console.log(`  stdout:\n${clip(r.out).split("\n").map((l) => "    " + l).join("\n")}`);
    if (r.err.trim()) console.log(`  stderr:\n${clip(r.err).split("\n").map((l) => "    " + l).join("\n")}`);
  }
}

const arg = process.argv[2];
const targets = arg ? [arg] : Object.keys(CLIS);
console.log(`平台: ${process.platform} · prompt: ${PROMPT}`);
for (const t of targets) {
  // eslint-disable-next-line no-await-in-loop
  await probe(t);
}
console.log(
  `\n说明：找到能产生“✓ 有输出”的策略后告诉我，我就把对应 adapter 的 promptArgs/输入方式改成它。`,
);
