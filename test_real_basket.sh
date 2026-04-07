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
echo "=== Shopping Basket System ==="
echo ""

# Create basket actor
echo "--- Creating Basket ---"
./llmact init --force --name basket "Shopping basket. Track: items (id, name, price, quantity), subtotal, tax_rate, tax_amount, shipping_cost, total. Calculate: subtotal = sum(item_price * quantity), tax = subtotal * tax_rate, total = subtotal + tax + shipping."

# Set tax rate
echo ""
echo "--- Setting Tax Rate ---"
./llmact msg --name basket "Set tax_rate to 23% (Polish VAT)"

# Add shipping calculator
echo ""
echo "--- Setting Shipping Rules ---"
./llmact init --force --name shipping "Shipping calculator. Rules: weight<=1kg=10 PLN, weight<=5kg=20 PLN, weight>5kg=50 PLN. Track: base_cost, weight_kg, final_cost."

# Add items
echo ""
echo "--- Adding Items ---"
./llmact msg --name basket "Add item: Laptop price=3000 quantity=1 weight=2kg"
./llmact msg --name basket "Add item: Mouse price=50 quantity=2 weight=0.5kg"
./llmact msg --name basket "Add item: Keyboard price=200 quantity=1 weight=1kg"
./llmact msg --name basket "Add item: USB Cable price=20 quantity=5 weight=0.1kg"

# Calculate shipping
echo ""
echo "--- Calculating Shipping ---"
./llmact msg --name shipping "Calculate for weight: Laptop 2kg + Mouse 0.5kg*2 + Keyboard 1kg + USB 0.1kg*5 = 2+1+1+0.5 = 4.5kg"
./llmact msg --name basket "Set shipping_cost to 20 PLN" --deps shipping

# Final summary
echo ""
echo "--- Basket Summary ---"
./llmact ask --name basket "Show complete basket state as JSON"
./llmact ask --name basket "Show as formatted receipt: Item | Qty | Price | Total"

echo ""
echo "=== Done ==="
