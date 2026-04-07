#!/bin/bash
set -e

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
# export LLM_MODEL="gemma4:e2b"
export LLM_MODEL="gemma4:31b-cloud"
# export LLM_MODEL="gpt-oss:20b-cloud"
# export LLM_MODEL="gpt-oss:120b-cloud"
export LLM_TEMPERATURE=0

echo "=== Determinism Test $LLM_MODEL ==="
echo "Temperature: 0 (should be deterministic)"
echo ""

deno compile --allow-all llmact.ts
chmod +x llmact

echo ""
echo "--- Test 1: Running SAME command 3x ---"
rm -f counter*
./llmact init --force --name counter "simple counter with increment"
echo ""
echo "=== RUN 1 ==="
./llmact msg --debug --name counter "increment by 5"
echo ""
echo "=== RUN 2 ==="
./llmact msg --debug --name counter "increment by 5"
echo ""
echo "=== RUN 3 ==="
./llmact msg --debug --name counter "increment by 5"
echo ""
echo "Final state after 3x 'increment by 5':"
cat counter.state.md
echo ""

echo ""
echo "--- Test 2: Same ask 3x ---"
rm -f counter*
./llmact init --force --name counter "simple counter with increment"
./llmact msg --debug --name counter "increment by 5"
./llmact msg --debug --name counter "increment by 5"
./llmact msg --debug --name counter "increment by 5"
echo ""
echo "Ask 1:"
./llmact ask --debug --stats --name counter "what is the counter value?"
echo ""
echo "Ask 2:"
./llmact ask --debug --stats --name counter "what is the counter value?"
echo ""
echo "Ask 3:"
./llmact ask --debug --stats --name counter "what is the counter value?"

echo ""
echo "--- Test 3: Lock mechanism test (parallel execution) ---"
rm -f locktest*
./llmact init --force --name locktest "simple counter"
./llmact msg --debug --name locktest "increment by 1"
./llmact msg --debug --name locktest "increment by 1"
./llmact msg --debug --name locktest "increment by 1"
echo ""
echo "Final state:"
cat locktest.state.md

echo ""
echo "=== Determinism tests completed! ==="
