#!/bin/bash
# setup.sh <round> <brief> <arm> <rep>
set -eu
S=$AB
D=$S/runs/$1/$2-$3-$4; rm -rf $D; mkdir -p $D/skills
cp -r $S/t/node_modules $S/t/package.json $D/
cp -r $S/skills-$3 $D/skills/givemotion
mkdir -p $D/fonts && cp /home/user/givemotion/src/runtime/fonts/*.woff2 $D/fonts/
cp $S/briefs/$2.md $D/brief.md
echo $D
