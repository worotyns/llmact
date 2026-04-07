#!/bin/bash
set -e

export LLM_API_URL="http://localhost:11434/v1/chat/completions"
export LLM_API_KEY="ollama"
export LLM_MODEL="gemma4:31b-cloud"
# export LLM_MODEL="gpt-oss:20b-cloud"
# export LLM_MODEL="gpt-oss:120b-cloud"
export LLM_TEMPERATURE=0

deno compile --allow-all llmact.ts
chmod +x llmact

echo ""
echo "=== Barber Shop Management System ==="
echo ""

# Create barbers (includes chair assignment)
echo "--- Creating Barbers ---"
./llmact init --force --name barber_bob "Barber Bob. Chair: Station-A. Price: 80 PLN. Commission: 40%."
./llmact init --force --name barber_alice "Barber Alice. Chair: Station-B. Price: 80 PLN. Commission: 40%."

# Create customers
echo ""
echo "--- Creating Customers ---"
./llmact init --force --name customer_bob "Customer Bob. Track visits: barber, chair, date, time, type=completed/absent, amount."

# Record visits (include barber and chair in command)
echo ""
echo "--- Recording Visits ---"
./llmact msg --name customer_bob "Add visit: barber=barber_bob chair=Station-A date=2026-04-01 time=10:00 type=completed amount=80" --deps barber_bob
./llmact msg --name customer_bob "Add visit: barber=barber_alice chair=Station-B date=2026-04-01 time=14:00 type=completed amount=80" --deps barber_alice
./llmact msg --name customer_bob "Add visit: barber=barber_bob chair=Station-A date=2026-04-02 time=11:00 type=completed amount=80" --deps barber_bob
./llmact msg --name customer_bob "Add visit: barber=barber_bob chair=Station-A date=2026-04-03 time=09:00 type=absent amount=0" --deps barber_bob

# Settlement (aggregate from deps)
echo ""
echo "--- Daily Summary ---"
./llmact init --force --name daily_summary "Daily summary dashboard. Track: barber_metrics with (barber_id, chair, visits, revenue, commission=revenue*commission_rate) - link chair from barber state, chair_metrics with (chair_name, visits), customer_metrics with (customer_id, visits, attendance), global_totals."

echo ""
echo "--- Calculating Summary ---"
./llmact msg --name daily_summary "Calculate April 2026 summary. From barber_bob state get: chair, price=80, commission_rate=40%. From barber_alice state get: chair, price=80, commission_rate=40%. From customer_bob visits get visit details. Calculate commission = revenue * commission_rate. Link each barber to their chair." --deps customer_bob --deps barber_bob --deps barber_alice

echo ""
echo "--- Summary Results ---"
./llmact ask --name daily_summary "Show complete state as JSON"
./llmact ask --name daily_summary "Show markdown table: Barber | Chair | Visits | Revenue | Commission"

echo ""
echo "=== Done ==="
