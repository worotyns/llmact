#!/bin/bash
set -e

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
# export LLM_MODEL="gemma4:e2b"
export LLM_MODEL="gemma4:31b-cloud"
# export LLM_MODEL="gpt-oss:20b-cloud"
# export LLM_MODEL="gpt-oss:120b-cloud"
export LLM_TEMPERATURE=0

deno compile --allow-all llmact.ts
chmod +x llmact

echo ""
echo "=== Taxi Ride Example ==="
echo ""

# Create taxi meter
echo "--- Creating Taxi Meter ---"
./llmact init --force --name taxi "Taxi meter. Track: base_fare, per_km_rate, per_min_rate, stop_time_minutes, distance_km, total. Initialize with empty values."

# Set rates
echo ""
echo "--- Setting Rates ---"
./llmact msg --name taxi "Set base_fare=10 PLN, per_km_rate=3 PLN, per_min_rate=1 PLN"

# Start ride
echo ""
echo "--- Recording Ride ---"
./llmact msg --name taxi "Add point A at 10:00"
./llmact msg --name taxi "Add point B at 10:30, distance 15km"
./llmact msg --name taxi "Stop for 20 minutes"

# Calculate price
echo ""
echo "--- Price Summary ---"
./llmact ask --name taxi "What is the total price?"
./llmact ask --name taxi "Show complete state as JSON"
./llmact ask --name taxi "Show breakdown: base + distance + time + stops"

echo ""
echo "=== Done ==="
