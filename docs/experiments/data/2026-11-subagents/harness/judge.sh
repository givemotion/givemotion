#!/bin/bash
# judge.sh <round> <brief> <vidA-dir-name> <vidB-dir-name> [n judges=4] : balanced order, blind
set -u
S=$AB; H=$S/harness
R=$S/runs/$1; J=$R/judging/$2-$3-vs-$4; N=${5:-4}
mkdir -p $J/packs; : > $J/key.txt
for v in $3 $4; do [ -d $J/packs/$v ] || bash $H/pack.sh $R/$v/out/video.mp4 $J/packs/$v; done
for j in $(seq 1 $N); do
  D=$J/judge-$j; rm -rf $D; mkdir -p $D; cp $S/briefs/$2.md $D/brief.md
  if [ $((j%2)) = 1 ]; then X=$3; Y=$4; else X=$4; Y=$3; fi
  cp -r $J/packs/$X $D/A; cp -r $J/packs/$Y $D/B; echo "judge-$j A=$X B=$Y" >> $J/key.txt
  P=$(sed "s#{DIR}#$D#g" $H/judge-prompt.txt)
  ( cd $D && claude -p "$P" --model claude-opus-5-5 --effort medium \
      --permission-mode default --allowedTools Read Glob \
      --disallowedTools Bash Edit Write WebFetch WebSearch Agent Task Workflow \
      --strict-mcp-config --setting-sources project,local \
      --output-format stream-json --verbose > $J/judge-$j.jsonl 2> $J/judge-$j.stderr ) &
done
wait
python3 $H/scores.py $J
