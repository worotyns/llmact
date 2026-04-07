// llm-actor.ts
// Multi-actor file-based LLM runtime
// Features:
// - named actors (--name)
// - init from description
// - per-actor state/messages files
// - deps between actors (--deps name)
// - Ollama/OpenAI compatible

import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";

// ---- config ----
const API_URL =
  Deno.env.get("LLM_API_URL") || "http://localhost:11434/v1/chat/completions";
const API_KEY = Deno.env.get("LLM_API_KEY") || "ollama";
const MODEL = Deno.env.get("LLM_MODEL") || "llama3";
const TEMPERATURE = Number(Deno.env.get("LLM_TEMPERATURE") || 0);

// ---- utils ----
function defFile(name: string) {
  return `${name}.definition.md`;
}

function stateFile(name: string) {
  return `${name}.state.md`;
}

function messagesFile(name: string) {
  return `${name}.messages.md`;
}

function lockFile(name: string) {
  return `${name}.lock`;
}

const locks = new Map<string, Promise<void>>();

async function acquireLock(name: string, debug: boolean): Promise<() => void> {
  const lf = lockFile(name);

  const waitForLock = async () => {
    while (true) {
      try {
        if (!(await exists(lf))) {
          await Deno.writeTextFile(lf, `${Deno.pid} ${Date.now()}`);
          if (debug) console.log(`[LOCK] Acquired lock for: ${name}`);
          return;
        }
        if (debug) console.log(`[LOCK] Waiting for lock: ${name}`);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        await Deno.writeTextFile(lf, `${Deno.pid} ${Date.now()}`);
        return;
      }
    }
  };

  const prev = locks.get(name);
  locks.set(
    name,
    (prev || Promise.resolve()).then(() => waitForLock()),
  );
  await locks.get(name)!;

  return () => releaseLock(name, debug);
}

function releaseLock(name: string, debug: boolean) {
  const lf = lockFile(name);
  try {
    Deno.removeSync(lf);
    if (debug) console.log(`[LOCK] Released lock for: ${name}`);
  } catch {}
  locks.delete(name);
}

async function readFileSafe(path: string): Promise<string> {
  try {
    if (await exists(path)) return await Deno.readTextFile(path);
    return "";
  } catch {
    return "";
  }
}

async function appendFile(path: string, content: string) {
  const prev = await readFileSafe(path);
  await Deno.writeTextFile(path, prev + "\n" + content);
}

// ---- LLM ----
let totalTokens = 0;

async function callLLM(messages: any[], debug: boolean = false) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: TEMPERATURE,
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Cannot call LLM ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const content =
    json.choices?.[0]?.message?.content || json.message?.content || "";

  if (debug) {
    const usage = json.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const total = usage.total_tokens || 0;
    totalTokens += total;
    console.log(
      `[DEBUG] Tokens: prompt=${promptTokens}, completion=${completionTokens}, total=${total}, cumulative=${totalTokens}`,
    );
  }

  return content;
}

// ---- INIT ----
function initSystemPrompt() {
  return `You are an ACTOR COMPILER. Create a stateful actor from the description.

CRITICAL RULES:
1. Output MUST start with "---DEFINITION---"
2. Output MUST contain "---STATE---" marker
3. State must be simple key: value pairs
4. Keep definitions minimal - only essential rules

OUTPUT FORMAT:

---DEFINITION---
# Actor
[One-line name and purpose]

## Logic
- [1-3 rules, be specific]

## Rules
- deterministic

---STATE---
[key]: [value]
[key]: [value]

Start with "---DEFINITION---". No preamble.`;
}

async function initActor(
  name: string,
  desc: string,
  force: boolean,
  debug: boolean,
) {
  const release = await acquireLock(name, debug);
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const df = defFile(name);
    const sf = stateFile(name);
    const mf = messagesFile(name);

    if ((await exists(df)) && !force) {
      console.log("⚠️ actor exists. use --force");
      return;
    }

    if (debug) {
      console.log("[DEBUG] Creating actor:", name);
      console.log("[DEBUG] Description:", desc);
    }

    const output = await callLLM(
      [
        { role: "system", content: initSystemPrompt() },
        { role: "user", content: `${desc}\n\n[Request ID: ${requestId}]` },
      ],
      debug,
    );

    const defMatch = output.match(/---DEFINITION---([\s\S]*?)---STATE---/);
    const stateMatch = output.match(/---STATE---([\s\S]*)/);

    const defContent = defMatch ? defMatch[1].trim() : "";
    const stateContent = stateMatch ? stateMatch[1].trim() : "";

    await Deno.writeTextFile(df, defContent);
    await Deno.writeTextFile(sf, stateContent);
    await Deno.writeTextFile(mf, "# Messages\n");

    console.log(`✅ actor '${name}' created`);
  } finally {
    release();
  }
}

// ---- RUN ----
function runSystemPrompt() {
  return `You are an ACTOR RUNTIME. Process commands and update state.

CRITICAL:
1. Output MUST start with "## NEW_STATE"
2. State is key: value pairs, one per line
3. Output MUST end with "## LOG" followed by one action line
4. No code blocks, no explanations

IMPORTANT: If command needs data not in state, check DEPENDENCIES STATE. Fill missing info from deps.

OUTPUT FORMAT:
## NEW_STATE
[key]: [value]
[key]: [value]

## LOG
[one sentence action description]

Process the command and output now:`;
}

function buildPrompt(
  def: string,
  state: string,
  deps: string,
  input: string,
  requestId?: string,
) {
  return `# ACTOR DEFINITION
${def}

# STATE
${state}

# DEPENDENCIES STATE
${deps}

# COMMAND
${input}
${requestId ? `\n[Request ID: ${requestId}]` : ""}`;
}

function parseOutput(output: string) {
  const lines = output.split("\n");
  let stateLines: string[] = [];
  let logLine = "";
  let inState = false;
  let inLog = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "## NEW_STATE" || trimmed.startsWith("## NEW_STATE")) {
      inState = true;
      inLog = false;
      continue;
    }
    if (trimmed === "## LOG" || trimmed.startsWith("## LOG")) {
      inState = false;
      inLog = true;
      continue;
    }
    if (inState && trimmed && !trimmed.startsWith("#")) {
      stateLines.push(trimmed.replace(/^[-•*]\s*/, ""));
    }
    if (inLog && trimmed) {
      logLine = trimmed.replace(/^[-•*]\s*/, "");
      break;
    }
  }

  if (stateLines.length === 0) return null;

  return { state: stateLines.join("\n"), log: logLine };
}

async function loadDeps(names: string[]) {
  let out = "";
  for (const n of names) {
    const d = await readFileSafe(defFile(n));
    const s = await readFileSafe(stateFile(n));
    if (d || s) {
      out += `\n## DEPENDENCY ${n}\n`;
      if (s) out += `### State\n${s}\n`;
    }
  }
  return out;
}

async function runActor(
  name: string,
  input: string,
  depsNames: string[],
  debug: boolean,
  retries: number = 2,
) {
  const release = await acquireLock(name, debug);
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const df = defFile(name);
    const sf = stateFile(name);
    const mf = messagesFile(name);

    const def = await readFileSafe(df);
    const state = await readFileSafe(sf);
    const deps = await loadDeps(depsNames);

    if (!def) {
      console.error("missing actor definition. run init");
      return;
    }

    if (debug) {
      console.log("[DEBUG] Running actor:", name);
      console.log("[DEBUG] Input:", input);
      console.log("[DEBUG] Dependencies:", depsNames.join(", ") || "none");
    }

    let parsed = null;
    let lastOutput = "";
    let lastError = "";

    for (let i = 0; i <= retries; i++) {
      if (i > 0 && debug) {
        console.log(`[DEBUG] Retry ${i}/${retries}`);
      }

      lastOutput = await callLLM(
        [
          { role: "system", content: runSystemPrompt() },
          { role: "user", content: buildPrompt(def, state, deps, input) },
        ],
        debug,
      );

      parsed = parseOutput(lastOutput);

      if (parsed) break;
      
      lastError = lastOutput;
    }

    if (!parsed) {
      console.error("❌ Parse error after retries");
      if (debug) console.log(lastError);
      return;
    }

    await Deno.writeTextFile(sf, parsed.state);
    await appendFile(
      mf,
      `\n## ${new Date().toISOString()}\n${input}\n\n${parsed.log}`,
    );

    if (debug) {
      console.log("[DEBUG] Prompt sent:");
      console.log(buildPrompt(def, state, deps, input));
      console.log("[DEBUG] Response:", lastOutput);
    }
    
    console.log(parsed.log);
    if (debug) {
      console.log("\n--- STATE ---");
      console.log(parsed.state);
    }
  } finally {
    release();
  }
}

// ---- ASK ----
function askSystemPrompt() {
  return `ACTOR STATE ANALYZER. Answer questions about state. Be concise. Use provided state only.`;
}

async function askActor(
  name: string,
  question: string,
  depsNames: string[],
  debug: boolean,
) {
  const release = await acquireLock(name, debug);

  try {
    const df = defFile(name);
    const sf = stateFile(name);

    const def = await readFileSafe(df);
    const state = await readFileSafe(sf);
    const deps = await loadDeps(depsNames);

    if (!def) {
      console.error("missing actor definition. run init");
      return;
    }

    if (debug) {
      console.log("[DEBUG] Asking actor:", name);
      console.log("[DEBUG] Question:", question);
      console.log("[DEBUG] Dependencies:", depsNames.join(", ") || "none");
      console.log("[DEBUG] Current state:", state);
    }

    const prompt = `# ACTOR DEFINITION
${def}

# STATE
${state}

# DEPENDENCIES STATE
${deps}

# QUESTION
${question}`;

    const output = await callLLM(
      [
        { role: "system", content: askSystemPrompt() },
        { role: "user", content: prompt },
      ],
      debug,
    );

    console.log(output);
  } finally {
    release();
  }
}

// ---- CLI ----
function parseArgs(args: string[]) {
  let name = "default";
  let force = false;
  let debug = false;
  let stats = false;
  const deps: string[] = [];
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (a === "--deps" && args[i + 1]) {
      deps.push(args[++i]);
    } else if (a === "--force") {
      force = true;
    } else if (a === "--debug") {
      debug = true;
    } else if (a === "--stats") {
      stats = true;
    } else {
      rest.push(a);
    }
  }

  return { name, deps, force, debug, stats, rest };
}

async function main() {
  const [cmd, ...args] = Deno.args;
  const { name, deps, force, debug, stats, rest } = parseArgs(args);

  if (cmd === "init") {
    const desc = rest.join(" ");
    await initActor(name, desc, force, debug);
    if (stats) console.log(`\n[STATS] Session tokens: ${totalTokens}`);
    return;
  }

  if (cmd === "msg") {
    const input = [cmd, ...rest].join(" ");
    await runActor(name, input, deps, debug);
    if (stats) console.log(`\n[STATS] Session tokens: ${totalTokens}`);
    return;
  }

  if (cmd === "ask") {
    const question = rest.join(" ");
    await askActor(name, question, deps, debug);
    if (stats) console.log(`\n[STATS] Session tokens: ${totalTokens}`);
    return;
  }

  if (cmd === "stats") {
    console.log(`[STATS] Session tokens: ${totalTokens}`);
    return;
  }

  throw new Error("Missing command: msg, init, ask, or stats");
}

if (import.meta.main) main();
