#!/bin/bash
set -e

# Test calculator tool with gemma4:31b-cloud
# export LLM_MODEL="gemma4:e2b"
export LLM_MODEL="gemma4:31b-cloud"
# export LLM_MODEL="gpt-oss:20b-cloud"
# export LLM_MODEL="gpt-oss:120b-cloud"
export LLM_TEMPERATURE=0

echo "=== Tool Calling Test: Calculator ==="
echo ""

# Clean up
rm -f calc.definition.md calc.state.md calc.messages.md calc.lock 2>/dev/null || true

# Init actor
echo "1. Initializing calculator actor..."
deno run --allow-all llmact.ts init --debug --name calc "A simple calculator actor that tracks numbers and performs arithmetic operations"

echo ""
echo "2. Testing calculator with msg command..."

# Test 1: Simple addition
echo "   Test 1: 10 + 5 = ?"
deno run --allow-all llmact.ts msg --debug --name calc "add 10 and 5"

# Test 2: Multiplication
echo ""
echo "   Test 2: 3 * 7 = ?"
deno run --allow-all llmact.ts msg --debug --name calc "multiply 3 by 7"

# Test 3: Percentage calculation (real-world use case)
echo ""
echo "   Test 3: Calculate 30% of 100"
deno run --allow-all llmact.ts msg --debug --name calc "calculate 30 percent of 100"

# Show final state
echo ""
echo "=== Final State ==="
cat calc.state.md 2>/dev/null || echo "No state file"

echo ""
echo "=== Message Log ==="
cat calc.messages.md 2>/dev/null || echo "No messages file"
