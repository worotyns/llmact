rm -fr aggregate*
rm -fr first*
rm -fr second*

deno compile --allow-all llmact.ts
chmod +x llmact

./llmact init --force --name first "counter with increment"
./llmact init --force --name second "counter with increment"
./llmact init --force --name aggregate "counter that sums deps"

./llmact msg --debug --name first "increment by 30"
./llmact msg --debug --name second "increment"
./llmact msg --debug --name aggregate "sum up all dependencies" --deps first --deps second

./llmact ask --name second "what are current value of counter?"
./llmact ask --name aggregate "how many dependencies you sum up last time?"
