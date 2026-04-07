#!/bin/bash
set -e

# Test get_current_time tool with gemma4:31b-cloud
export LLM_MODEL="gemma4:31b-cloud"
export LLM_TEMPERATURE=0

cd /Users/worotyns/code/llmact

echo "=== Tool Calling Test: get_current_time ==="
echo ""

# Clean up
rm -f time.definition.md time.state.md time.messages.md time.lock 2>/dev/null || true

# Init actor
echo "1. Initializing time actor..."
deno run --allow-all llmact.ts init --debug --name time "An actor that tracks the current date and time"

echo ""
echo "2. Testing get_current_time tool..."

# Test 1: Get current date
echo "   Test 1: What is today's date?"
deno run --allow-all llmact.ts msg --debug --name time "What is today's date?"

# Test 2: Get current time
echo ""
echo "   Test 2: What time is it now?"
deno run --allow-all llmact.ts msg --debug --name time "What time is it right now?"

# Test 3: Calculate days until a date
echo ""
echo "   Test 3: How many days until January 1st next year?"
deno run --allow-all llmact.ts msg --debug --name time "How many days until January 1st next year?"

# Show final state
echo ""
echo "=== Final State ==="
cat time.state.md 2>/dev/null || echo "No state file"

echo ""
echo "=== Message Log ==="
cat time.messages.md 2>/dev/null || echo "No messages file"
