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
  return `${name}.md`;
}

function stateFile(name: string) {
  return `${name}.state.md`;
}

function messagesFile(name: string) {
  return `${name}.messages.md`;
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
  const content = json.choices?.[0]?.message?.content || json.message?.content || "";
  
  if (debug) {
    const usage = json.usage || {};
    console.log("\n[DEBUG] LLM Response:");
    console.log(`[DEBUG] Prompt tokens: ${usage.prompt_tokens || 'N/A'}`);
    console.log(`[DEBUG] Completion tokens: ${usage.completion_tokens || 'N/A'}`);
    console.log(`[DEBUG] Total tokens: ${usage.total_tokens || 'N/A'}`);
  }
  
  return content;
}

// ---- INIT ----
function initSystemPrompt() {
  return `You are an ACTOR COMPILER.

Create a stateful actor with definition and initial state.

OUTPUT TWO FILES:

---DEFINITION---
# Actor
(name and purpose)

## Logic
- processing rules

## Rules
- deterministic behavior
- state transitions

---STATE---
# State
(initial state, or empty)

Only markdown. Separate files with the markers above.`;
}

async function initActor(name: string, desc: string, force: boolean, debug: boolean) {
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

  const output = await callLLM([
    { role: "system", content: initSystemPrompt() },
    { role: "user", content: desc },
  ], debug);

  const defMatch = output.match(/---DEFINITION---([\s\S]*?)---STATE---/);
  const stateMatch = output.match(/---STATE---([\s\S]*)/);

  const defContent = defMatch ? defMatch[1].trim() : "";
  const stateContent = stateMatch ? stateMatch[1].trim() : "";

  await Deno.writeTextFile(df, defContent);
  await Deno.writeTextFile(sf, stateContent);
  await Deno.writeTextFile(mf, "# Messages\n");

  console.log(`✅ actor '${name}' created`);
}

// ---- RUN ----
function runSystemPrompt() {
  return `You are an ACTOR RUNTIME.
When you return output you need to include whole state in STRICT FORMAT:
## NEW_STATE
...

## LOG
...

No extra text.`;
}

function buildPrompt(def: string, state: string, deps: string, input: string) {
  return `# ACTOR DEFINITION
${def}

# STATE
${state}

# DEPENDENCIES STATE
${deps}

# COMMAND
${input}`;
}

function parseOutput(output: string) {
  const s = output.match(/## NEW_STATE([\s\S]*?)## LOG/);
  const l = output.match(/## LOG([\s\S]*)/);
  if (!s || !l) return null;
  return { state: s[1].trim(), log: l[1].trim() };
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

async function runActor(name: string, input: string, depsNames: string[], debug: boolean) {
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

  console.log(buildPrompt(def, state, deps, input));

  const output = await callLLM([
    { role: "system", content: runSystemPrompt() },
    { role: "user", content: buildPrompt(def, state, deps, input) },
  ], debug);

  const parsed = parseOutput(output);

  if (!parsed) {
    console.error("parse error");
    console.log(output);
    return;
  }

  await Deno.writeTextFile(sf, parsed.state);
  await appendFile(
    mf,
    `\n## ${new Date().toISOString()}\n${input}\n\n${parsed.log}`,
  );

  console.log(parsed.log);
  console.log("\n--- STATE ---");
  console.log(parsed.state);
}

// ---- ASK ----
function askSystemPrompt() {
  return `You are an ACTOR STATE ANALYZER.
You answer questions about the actor's current state.
Be concise and factual.
Only answer based on the provided state information.`;
}

async function askActor(name: string, question: string, depsNames: string[], debug: boolean) {
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

  const output = await callLLM([
    { role: "system", content: askSystemPrompt() },
    { role: "user", content: prompt },
  ], debug);

  console.log(output);
}

// ---- CLI ----
function parseArgs(args: string[]) {
  let name = "default";
  let force = false;
  let debug = false;
  const deps: string[] = [];
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") {
      name = args[++i];
    } else if (a === "--deps") {
      deps.push(args[++i]);
    } else if (a === "--force") {
      force = true;
    } else if (a === "--debug") {
      debug = true;
    } else {
      rest.push(a);
    }
  }

  return { name, deps, force, debug, rest };
}

async function main() {
  const [cmd, ...args] = Deno.args;
  const { name, deps, force, debug, rest } = parseArgs(args);

  if (cmd === "init") {
    const desc = rest.join(" ");
    await initActor(name, desc, force, debug);
    return;
  }

  if (cmd === "msg") {
    const input = [cmd, ...rest].join(" ");
    await runActor(name, input, deps, debug);
    return;
  }

  if (cmd === "ask") {
    const question = rest.join(" ");
    await askActor(name, question, deps, debug);
    return;
  }

  throw new Error("Missing command: msg, init, or ask");
}

if (import.meta.main) main();
