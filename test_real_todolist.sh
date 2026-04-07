#!/bin/bash
set -e

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
export LLM_MODEL="gemma4:31b-cloud"
# export LLM_MODEL="gpt-oss:20b-cloud"
export LLM_TEMPERATURE=0

deno compile --allow-all llmact.ts
chmod +x llmact

echo ""
echo "=== Todo List Management System ==="
echo ""

# Create two todo lists
echo "--- Creating Todo Lists ---"
./llmact init --force --name todo_work "Work todo list. Track tasks: id, title, priority=low/medium/high, status=pending/completed, due_date."
./llmact init --force --name todo_personal "Personal todo list. Track tasks: id, title, priority, status, due_date."

# Add tasks to work list
echo ""
echo "--- Work Tasks ---"
./llmact msg --name todo_work "Add task: Fix critical bug in auth module priority=high status=pending"
./llmact msg --name todo_work "Add task: Review pull request priority=medium status=pending"
./llmact msg --name todo_work "Add task: Update documentation priority=low status=pending"
./llmact msg --name todo_work "Complete task: Fix critical bug in auth module"
./llmact msg --name todo_work "Add task: Deploy to staging priority=high status=pending"

# Add tasks to personal list
echo ""
echo "--- Personal Tasks ---"
./llmact msg --name todo_personal "Add task: Buy groceries priority=high status=pending"
./llmact msg --name todo_personal "Add task: Go to gym priority=medium status=pending"
./llmact msg --name todo_personal "Add task: Read a book priority=low status=pending"
./llmact msg --name todo_personal "Complete task: Buy groceries"
./llmact msg --name todo_personal "Add task: Call mom priority=high status=pending"

# Summarize each list
echo ""
echo "--- Work List Summary ---"
./llmact ask --name todo_work "Show task count by status, priority. List all pending tasks."
./llmact ask --name todo_work "Show as markdown table: ID | Task | Priority | Status"

echo ""
echo "--- Personal List Summary ---"
./llmact ask --name todo_personal "Show task count by status, priority. List all pending tasks."
./llmact ask --name todo_personal "Show as markdown table: ID | Task | Priority | Status"

# Combined summary using deps
echo ""
echo "--- Combined Summary (from both lists) ---"
./llmact init --force --name todo_summary "Combined todo summary. Aggregate tasks from multiple lists."
./llmact msg --name todo_summary "Combine tasks from both lists. Show total count, completed count, pending count. Group by priority. Show high priority pending tasks first." --deps todo_work --deps todo_personal

echo ""
echo "--- Combined Summary Results ---"
./llmact ask --name todo_summary "Show as markdown table: List | Task | Priority | Status"
./llmact ask --name todo_summary "Show summary: total tasks, completed, pending, by priority"

echo ""
echo "=== Done ==="
