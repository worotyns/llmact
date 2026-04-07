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
  let waitStart = 0;

  const waitForLock = async () => {
    while (true) {
      try {
        if (!(await exists(lf))) {
          await Deno.writeTextFile(lf, `${Deno.pid} ${Date.now()}`);
          if (debug) {
            const waited = waitStart
              ? ` (waited ${Date.now() - waitStart}ms)`
              : "";
            console.log(`[LOCK] Acquired${waited}: ${name}`);
          }
          return;
        }
        if (debug) {
          if (!waitStart) waitStart = Date.now();
          console.log(`[LOCK] Waiting for lock: ${name}...`);
        }
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

// ---- TOOLS ----
const TOOLS = [
  {
    type: "function",
    function: {
      name: "calculator",
      description:
        "Evaluate a mathematical expression. Use for calculations like 2+2, 10*5, sqrt(16), etc.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "Mathematical expression (e.g., '10 * 0.30' or '100 + 50')",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current date and time.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_dates",
      description: "Calculate difference between two dates. Returns days, hours, minutes between dates.",
      parameters: {
        type: "object",
        properties: {
          date1: {
            type: "string",
            description: "First date (ISO format like '2026-01-01' or '2026-01-01T12:00:00')",
          },
          date2: {
            type: "string",
            description: "Second date (ISO format like '2026-01-01' or '2026-01-01T12:00:00')",
          },
        },
        required: ["date1", "date2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_date",
      description: "Create a date string from year, month, and day components.",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "number",
            description: "Year (e.g., 2026)",
          },
          month: {
            type: "number",
            description: "Month (1-12)",
          },
          day: {
            type: "number",
            description: "Day (1-31)",
          },
        },
        required: ["year", "month", "day"],
      },
    },
  },
];

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "calculator": {
      const expr = args.expression;
      try {
        const result = Function(`"use strict"; return (${expr})`)();
        return JSON.stringify({ result });
      } catch (e: any) {
        return JSON.stringify({ error: `Error: ${e.message}` });
      }
    }
    case "get_current_time":
      return JSON.stringify({ datetime: new Date().toISOString() });
    case "diff_dates": {
      const d1 = new Date(args.date1);
      const d2 = new Date(args.date2);
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
        return JSON.stringify({ error: "Invalid date format" });
      }
      const diffMs = Math.abs(d2.getTime() - d1.getTime());
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return JSON.stringify({ days, hours, minutes, total_ms: diffMs });
    }
    case "make_date": {
      const { year, month, day } = args;
      const date = new Date(year, month - 1, day);
      if (isNaN(date.getTime())) {
        return JSON.stringify({ error: "Invalid date components" });
      }
      return JSON.stringify({ 
        date: date.toISOString().split("T")[0],
        datetime: date.toISOString(),
        weekday: date.toLocaleDateString("en-US", { weekday: "long" })
      });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---- LLM ----
let totalTokens = 0;

interface ToolCall {
  name: string;
  args: Record<string, any>;
  result: string;
}

interface LLMResult {
  content: string;
  toolCalls: ToolCall[];
}

async function callLLM(
  messages: any[],
  debug: boolean = false,
  useTools: boolean = false,
): Promise<LLMResult> {
  const body: any = {
    model: MODEL,
    temperature: TEMPERATURE,
    messages,
  };

  if (useTools) {
    body.tools = TOOLS;
    body.tool_choice = "auto";
    if (debug)
      console.log(
        `[DEBUG] Sending ${TOOLS.length} tools: ${TOOLS.map((t) => t.function.name).join(", ")}`,
      );
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Cannot call LLM ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const allToolCalls: ToolCall[] = [];

  if (useTools && choice?.message?.tool_calls) {
    const toolCalls = choice.message.tool_calls;
    if (debug) console.log(`[TOOL] ${toolCalls.length} call(s)`);

    const toolResults = toolCalls.map((tc: any) => {
      const args = JSON.parse(tc.function.arguments);
      const result = executeTool(tc.function.name, args);
      if (debug)
        console.log(
          `[TOOL] ${tc.function.name}(${JSON.stringify(args)}) = ${result}`,
        );
      allToolCalls.push({ name: tc.function.name, args, result });
      return {
        tool_call_id: tc.id,
        role: "tool",
        name: tc.function.name,
        content: result,
      };
    });

    messages.push(choice.message, ...toolResults);
    const recursiveResult = await callLLM(messages, debug, false);
    return {
      content: recursiveResult.content,
      toolCalls: [...allToolCalls, ...recursiveResult.toolCalls],
    };
  }

  const content = choice?.message?.content || "";

  if (debug) {
    const usage = json.usage || {};
    totalTokens += usage.total_tokens || 0;
    console.log(
      `[DEBUG] Tokens: total=${usage.total_tokens || 0}, cumulative=${totalTokens}`,
    );
  }

  return { content, toolCalls: allToolCalls };
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

    const result = await callLLM(
      [
        { role: "system", content: initSystemPrompt() },
        { role: "user", content: `${desc}\n\n[Request ID: ${requestId}]` },
      ],
      debug,
    );

    const output = result.content;
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

AVAILABLE TOOLS:
- calculator(expression): Calculate math (e.g., "10 * 0.30" for 30% of 10)
- get_current_time(): Get current datetime
- diff_dates(date1, date2): Calculate days/hours/minutes between two dates
- make_date(year, month, day): Create a date from components

Use calculator for math. Use date tools for date operations.

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
    let allToolCalls: ToolCall[] = [];

    for (let i = 0; i <= retries; i++) {
      if (i > 0 && debug) {
        console.log(`[DEBUG] Retry ${i}/${retries}`);
      }

      const result = await callLLM(
        [
          { role: "system", content: runSystemPrompt() },
          { role: "user", content: buildPrompt(def, state, deps, input) },
        ],
        debug,
        true, // useTools
      );

      lastOutput = result.content;
      allToolCalls.push(...result.toolCalls);

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

    let logEntry = `## ${new Date().toISOString()}\n${input}\n\n${parsed.log}`;
    if (allToolCalls.length > 0) {
      const toolLog = allToolCalls
        .map(
          (tc) =>
            `[TOOL] ${tc.name}(${JSON.stringify(tc.args)}) = ${tc.result}`,
        )
        .join("\n");
      logEntry += `\n\n${toolLog}`;
    }
    await appendFile(mf, `\n${logEntry}`);

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

    const result = await callLLM(
      [
        { role: "system", content: askSystemPrompt() },
        { role: "user", content: prompt },
      ],
      debug,
    );

    console.log(result.content);
  } finally {
    release();
  }
}

// ---- EVOLVE ----
function evolveSystemPrompt() {
  return `ACTOR EVOLUTION ENGINE. Improve actor definition based on performance.

CRITICAL:
1. Output MUST start with "---EVOLVED---"
2. Analyze recent messages for errors, confusion, or edge cases
3. Suggest specific improvements to Logic or Rules
4. Keep changes minimal and focused
5. If definition is good, output "---NO_CHANGES---" only

OUTPUT FORMAT:

---EVOLVED---
# Actor
[Improved one-line name and purpose]

## Logic
- [Improved 1-3 rules]

## Rules
- [Keep existing rules]

---END---

OR simply:

---NO_CHANGES---
Definition is adequate.`;
}

async function evolveActor(name: string, issue: string, debug: boolean) {
  const release = await acquireLock(name, debug);
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const df = defFile(name);
    const sf = stateFile(name);
    const mf = messagesFile(name);

    const def = await readFileSafe(df);
    const state = await readFileSafe(sf);
    const messages = await readFileSafe(mf);

    if (!def) {
      console.error("missing actor definition. run init");
      return;
    }

    if (debug) {
      console.log("[DEBUG] Evolving actor:", name);
      console.log("[DEBUG] Issue:", issue);
    }

    const prompt = `# CURRENT DEFINITION
${def}

# CURRENT STATE
${state}

# RECENT MESSAGES
${messages.slice(-2000)}

# ISSUE TO ADDRESS
${issue}

${requestId ? `\n[Request ID: ${requestId}]` : ""}`;

    const result = await callLLM(
      [
        { role: "system", content: evolveSystemPrompt() },
        { role: "user", content: prompt },
      ],
      debug,
    );

    const output = result.content;
    if (output.includes("---NO_CHANGES---")) {
      console.log("Definition is adequate, no changes needed.");
      return;
    }

    const evolvedMatch = output.match(/---EVOLVED---([\s\S]*?)---END---/);
    if (evolvedMatch) {
      const newDef = evolvedMatch[1].trim();
      const backupPath = `${df}.bak.${Date.now()}`;
      await Deno.writeTextFile(backupPath, def);
      await Deno.writeTextFile(df, newDef);
      console.log("✅ Actor definition evolved");
      console.log(`   Backup saved: ${backupPath.split("/").pop()}`);
      if (debug) {
        console.log("\n--- NEW DEFINITION ---");
        console.log(newDef);
      }
    } else {
      console.error("Failed to parse evolution output");
      if (debug) console.log(output);
    }
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

  if (cmd === "evolve") {
    const issue = rest.join(" ");
    await evolveActor(name, issue, debug);
    if (stats) console.log(`\n[STATS] Session tokens: ${totalTokens}`);
    return;
  }

  throw new Error("Missing command: msg, init, ask, evolve, or stats");
}

if (import.meta.main) main();
