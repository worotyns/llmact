# llmact - LLM Actor Runtime

Stateful actors stored in Markdown files.

## Commands

- `init --name <n> --force "description"` - Create actor
- `msg --name <n> "command"` - Run command
- `ask --name <n> "question"` - Query state
- `evolve --name <n> "issue description"` - Self-improve definition
- `--deps <actor>` - Include dependency states
- `--debug` - Show tokens & debug
- `--stats` - Show cumulative token usage

## Self-Evolution

Actors can evolve their own definitions to improve over time:

```bash
# After encountering issues, evolve the definition
./llmact evolve --name cart "Actor often forgets to validate negative quantities"

# Analyze recent messages and suggest improvements
./llmact evolve --name cart "Responses are inconsistent - sometimes state is updated, sometimes not"
```

Old definitions are backed up as `<name>.definition.md.bak.<timestamp>`.

## Tool Calling

Actors can use built-in tools for calculations:

- `calculator(expression)` - Evaluate math (e.g., "10 * 0.30" for tax)
- `get_current_time()` - Get current datetime

Tool calling works with gemma4:31b-cloud via Ollama. Local models (phi, gpt-oss) do not support function calling.

## Setup

```bash
deno compile --allow-all llmact.ts
chmod +x llmact

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
# export LLM_MODEL="gemma4:e2b"
export LLM_MODEL="gemma4:31b-cloud"
export LLM_TEMPERATURE=0
```

## Example

```bash
# Shopping cart
./llmact init --force --name cart "Shopping cart. Track items, quantities, prices."
./llmact msg --name cart "Add item: laptop price=3000 qty=1"
./llmact msg --name cart "Add item: mouse price=50 qty=2"
./llmact ask --name cart "What is the total?"

# Calculator with tool calling
./llmact init --force --name calc "A simple calculator actor that tracks numbers and performs arithmetic operations"
./llmact msg --debug --name calc "Calculate 30% of 100 = ?"
./llmact msg --debug --name calc "Add 50 and 25 = ?"
```

## Files

- `<name>.definition.md` - Actor definition
- `<name>.state.md` - Current state
- `<name>.messages.md` - Message log

## Requirements

- Deno 1.39+
- Ollama or OpenAI API
- Temperature 0 for determinism
- gemma4:31b-cloud for tool calling
