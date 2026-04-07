# llmact - LLM Actor Runtime

Stateful actors stored in Markdown files.

## Commands

- `init --name <n> --force "description"` - Create actor
- `msg --name <n> "command"` - Run command
- `ask --name <n> "question"` - Query state
- `--deps <actor>` - Include dependency states
- `--debug` - Show tokens & debug

## Setup

```bash
deno compile --allow-all llmact.ts
chmod +x llmact

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
export LLM_MODEL="gemma4:31b-cloud"
export LLM_TEMPERATURE=0
```

## Example

```bash
./llmact init --force --name cart "Shopping cart. Track items, quantities, prices."
./llmact msg --name cart "Add item: laptop price=3000 qty=1"
./llmact msg --name cart "Add item: mouse price=50 qty=2"
./llmact ask --name cart "What is the total?"
```

## Files

- `<name>.definition.md` - Actor definition
- `<name>.state.md` - Current state
- `<name>.messages.md` - Message log

## Requirements

- Deno 1.39+
- Ollama or OpenAI API
- Temperature 0 for determinism
