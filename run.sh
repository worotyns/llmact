rm -fr aggregate*
rm -fr first*
rm -fr second*

deno compile --allow-all llmact.ts
chmod +x llmact

./llmact init --force --name first "counter with increment"
./llmact init --force --name second "counter with increment"
./llmact init --force --name aggregate "counter that sums deps"

./llmact msg --name first "increment by 30"
./llmact msg --name second "increment"
./llmact msg --name aggregate "sum up all dependencies" --deps first --deps second
