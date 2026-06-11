// Fake ACP agent used by acp-agent-adapter.test.ts.
// Speaks just enough of the Agent Client Protocol (JSON-RPC 2.0 over ndjson
// on stdio) to exercise the client/adapter end to end without any real CLI:
//   node fake-acp-agent.fixture.mjs [happy|cancel|crash]
import readline from "node:readline";

const mode = process.argv[2] ?? "happy";
const rl = readline.createInterface({ input: process.stdin });
const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

let nextServerId = 100;
const pendingServerRequests = new Map();
let openPromptId = null;
let openPromptSession = "";

// Non-JSON stdout noise the client must tolerate.
process.stdout.write("fake-acp-agent booting\n");
// Internal tracing noise on stderr (like codex-acp's Rust logs) — must reach
// logs/final.stderr but never the live chat stream.
process.stderr.write("2026-06-11T00:00:00.000000Z ERROR codex_core::exec: exec error: windows sandbox: spawn setup refresh\n");

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  // Response to one of OUR (agent→client) requests.
  if (message.id !== undefined && message.method === undefined) {
    const handler = pendingServerRequests.get(message.id);
    if (handler) {
      pendingServerRequests.delete(message.id);
      handler(message);
    }
    return;
  }

  const { id, method, params } = message;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: true },
          ...(mode === "resume" ? { loadSession: true } : {}),
        },
      },
    });
    return;
  }

  if (method === "session/load") {
    const sessionId = params?.sessionId;
    // History replay precedes the load response — the client must NOT stream
    // these into the live chat.
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "旧历史回放。" } },
      },
    });
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "session/new") {
    if (mode === "crash") {
      process.exit(2);
    }
    send({ jsonrpc: "2.0", id, result: { sessionId: "sess_1" } });
    return;
  }

  if (method === "session/cancel") {
    if (openPromptId !== null) {
      send({ jsonrpc: "2.0", id: openPromptId, result: { stopReason: "cancelled" } });
      openPromptId = null;
      setTimeout(() => process.exit(0), 50);
    }
    return;
  }

  if (method === "session/prompt") {
    const sessionId = params?.sessionId ?? "sess_1";
    const update = (payload) =>
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: payload } });

    if (mode === "cancel") {
      openPromptId = id;
      openPromptSession = sessionId;
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "开始处理…" } });
      return; // waits for session/cancel
    }

    if (mode === "resume") {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "继续推进。" } });
      send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
      setTimeout(() => process.exit(0), 50);
      return;
    }

    // Adapter-incompatibility shape: prompt fails before any output (e.g.
    // claude-code-acp crashing on a fork's tool_use events).
    if (mode === "prompt-error") {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "Internal error", data: { details: "Cannot read properties of null (reading 'file_path')" } },
      });
      setTimeout(() => process.exit(1), 50);
      return;
    }

    // Failure after partial output — must NOT trigger the headless retry.
    if (mode === "midfail") {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "已经开始分析了。" } });
      setTimeout(() => {
        send({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
        setTimeout(() => process.exit(1), 50);
      }, 30);
      return;
    }

    update({
      sessionUpdate: "tool_call",
      toolCallId: "tc_1",
      title: "读取 project.godot",
      kind: "read",
      status: "in_progress",
    });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "正在分析项目。" } });

    const permissionId = nextServerId++;
    pendingServerRequests.set(permissionId, (response) => {
      const outcome = response.result?.outcome;
      if (outcome?.outcome === "selected") {
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "已完成修改。" } });
        send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
      } else {
        send({ jsonrpc: "2.0", id, result: { stopReason: "refusal" } });
      }
      setTimeout(() => process.exit(0), 50);
    });
    send({
      jsonrpc: "2.0",
      id: permissionId,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "tc_2", title: "写入 main.gd", kind: "edit" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
