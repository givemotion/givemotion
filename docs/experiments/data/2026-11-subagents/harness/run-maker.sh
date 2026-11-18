#!/bin/bash
# run-maker.sh <dir>
set -u
D=$1; H=$(dirname $0)
PROMPT=$(sed "s#{DIR}#$D#g" $H/${PF:-prompt.txt})
ALLOW=(Read Glob Grep Edit Write Agent Task
  "Bash(npx:*)" "Bash(npm:*)" "Bash(node:*)" "Bash(ffmpeg:*)" "Bash(ffprobe:*)" "Bash(python3:*)"
  "Bash(ls:*)" "Bash(cat:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(grep:*)" "Bash(find:*)" "Bash(wc:*)"
  "Bash(mkdir:*)" "Bash(cp:*)" "Bash(mv:*)" "Bash(rm:*)" "Bash(sed:*)" "Bash(echo:*)" "Bash(cd:*)"
  "Bash(pwd)" "Bash(du:*)" "Bash(file:*)" "Bash(sort:*)" "Bash(awk:*)" "Bash(test:*)" "Bash(date:*)")
cd $D
date +%s > meta.start
CLAUDE_CODE_SUBAGENT_MODEL=${SUBM:-} claude -p "$PROMPT" --model claude-opus-5-5 --effort ${EFF:-high} \
  --permission-mode acceptEdits --allowedTools "${ALLOW[@]}" \
  --strict-mcp-config --setting-sources project,local \
  --disallowedTools WebFetch WebSearch Workflow \
  --output-format stream-json --verbose > ../$(basename $D).jsonl 2> ../$(basename $D).stderr
echo $? > meta.exit
date +%s > meta.end
