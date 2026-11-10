// llms.txt for the website: what givemotion is, how to install it, where the agent docs live (absolute links),
// and the test results with their dates and versions. Generated from the same data as the page.
import { REPO, SITE, blob, LATEST_VERSION, LATEST_RELEASE_DATE, showcases, rounds, allSets, roundsMeta } from '../data/tests';
import { faq } from '../data/faq';

export function GET() {
  const tests = showcases
    .map((s) => {
      const sc = s.scores ? ` Judges (1-10): ${s.scores.map((x) => `${x.name} ${x.score}`).join(', ')}.` : '';
      return `- ${s.title} (${s.date}; givemotion ${s.givemotion.label}${s.givemotion.note ? `, ${s.givemotion.note}` : ''}${s.others ? `; ${s.others}` : ''}; ${s.models}). ${s.summary}${sc} Video: ${SITE}${s.video.src}. Report: ${blob(s.report)}`;
    })
    .join('\n');
  const roundLines = rounds
    .map((r) => `- Round ${r.n} (${r.date}; ${r.versions}): judges' mean givemotion ${r.mean[0]}, Remotion ${r.mean[1]}, HyperFrames ${r.mean[2]}.`)
    .join('\n');
  const totals = allSets.map((r) => `- ${r.row}: givemotion ${r.gm}, Remotion ${r.rem}, HyperFrames ${r.hf}`).join('\n');

  const body = `# givemotion

> Make videos with AI, free and open source (MIT). A video engine built for AI coding agents (Claude Code, Codex, Cursor) to make motion graphics. It is not a generative video model: the agent writes one HTML/CSS/JS page, checks it (\`check\`), looks at key frames (\`snapshot\`, \`review\`) and renders MP4/WebM/ProRes/GIF. After an edit, a new render redoes only the 1-2 s parts that changed, byte-identical to a full render. Free for any use, including companies (MIT, zero npm dependencies, no telemetry, no account). Needs Node 20+, ffmpeg and Chrome.

Latest version: ${LATEST_VERSION} (npm, ${LATEST_RELEASE_DATE}). Created by Leonardo Grigorio (https://github.com/leonardogrig) as an independent open-source project. Website: ${SITE}. Repository: ${REPO}.

## Install

- New project: \`npx givemotion init my-video\` (starter video + the agent skill pack)
- Existing project: \`npx givemotion skill\` (\`.claude/skills/givemotion/\`, \`.agents/skills/givemotion/\`, a section in \`AGENTS.md\`)
- Claude Code plugin: \`/plugin marketplace add givemotion/givemotion\`, then \`/plugin install givemotion@givemotion\`
- Skills CLI: \`npx skills add givemotion/givemotion\`

## Agent docs

- [SKILL.md](${blob('skills/givemotion/SKILL.md')}): the loop, composition format, timing, quality rules, built-in motion
- [References](${REPO}/tree/main/skills/givemotion/references): techniques, API, camera, timeline, charts, diagrams, audio, output, review, check codes, genres
- [Repository llms.txt](${blob('llms.txt')})
- [README](${blob('README.md')})

## Test results (fresh AI agents, docs only, blind AI judges)

Random-brief rounds 2-8 (${roundsMeta.date}; ${roundsMeta.models}; ${roundsMeta.machine}). Method, prompts, raw scores and the kit to rerun: ${blob(roundsMeta.method)}

${roundLines}

All 22 judged sets:
${totals}

One or two runs per tool per brief and AI judges looking at frames: a running record, not a final benchmark. givemotion was last in rounds 2-6, tied in round 7 and led round 8; its agents cost the most in round 8.

## Test videos

${tests}

## FAQ

${faq.map((f) => `### ${f.q}\n${f.a.join(' ')}`).join('\n\n')}

givemotion is not affiliated with Remotion or HeyGen (HyperFrames). Their names are trademarks of their owners.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
