# LLM Actor Runtime

`llmact` is a simple LLM runtime (e.g., Ollama or OpenAI) that allows you to
create stateful actors stored in Markdown files and execute commands on them
with dependency support between actors.

Each actor has its own state file (`<name>.md`) and message log file
(`<name>.messages.md`). You can define actors in natural language, execute
commands, and aggregate their states.

---

## Features

- `init --name <name> "description"` - creates a new actor from the given
  description.
- `--force` - overwrite an existing actor.
- `--deps <otherActor>` - used when running commands to include other actors'
  states.
- `--debug` - show debug information and token usage stats.
- Execute commands on actors (`llmact msg --name <name> "command"`).
- Ask questions about actor state (`llmact ask --name <name> "question"`).

---

## Example Usage

### Compile

```bash
deno compile --allow-all llmact.ts
chmod +x llmact
```

### Prepare env

```bash
export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
export LLM_MODEL="gemma4:e2b"
# or
export LLM_MODEL="gpt-oss:20b:cloud"
```

### Creating actors

```bash
# Actor with a counter
./llmact init --name first "counter with increment"
./llmact init --name second "counter with increment"

# Actor that aggregates other actors' states
./llmact init --name aggregate "counter that sums values from dependencies"
```

### Running commands

```bash
# Increment first actor
./llmact msg --name first "increment by 30"

# Increment second actor
./llmact msg --name second "increment"

# Aggregate states (sum first and second)
./llmact msg --name aggregate "sum up all deps" --deps first --deps second
```

### Asking questions about state

```bash
# Ask about current counter value
./llmact ask --name second "what are current value of counter?"

# Ask about aggregates with dependencies
./llmact ask --name aggregate "how many dependencies you sum up last time?" --deps first --deps second

# With debug info
./llmact ask --name first "what is the state?" --debug
```

### Viewing state and logs

```bash
cat first.state.md # should be 30
cat second.state.md # should be 1
cat aggregate.state.md # should be 31
```

---

## Requirements

- Deno 1.39+
- LLM (e.g., Ollama locally or OpenAI API)
- Deno permissions: `-A` (read/write files)

---

## Notes

- Actor states are in Markdown, so they can be easily edited manually.
- Aggregation depends on the LLM correctly parsing the Markdown files.
- For more stability, a JSON-based schema can be introduced instead of Markdown.

---

This tool allows you to create local, stateful "agent-like" systems that can
interact, log their actions, and share state in a simple, modular way.
