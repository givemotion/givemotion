# Contributing to givemotion

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- **The code layout and the rules** are in [`AGENTS.md`](AGENTS.md) (written for AI agents and people alike).
- **Bigger changes:** open an issue first, so we can agree on the approach before you spend time on it.
  Changes that break existing compositions need a very good reason.
- **Write everything fresh.** Do not copy code from other video frameworks or from projects whose license is not
  MIT-compatible. Learning from their docs and features is fine.
- **No new required npm dependencies.** givemotion runs on Node.js built-ins only.

## Setup

```bash
git clone https://github.com/leonardogrig/givemotion.git
cd givemotion
npx givemotion install   # or use your own Chrome
npm test                 # needs Chrome and ffmpeg
```

## A good pull request

- `npm test` passes.
- Rendering stays deterministic: 1 worker and N workers give byte-identical output.
- If you changed something visual (a block, the runtime, an example), run `node src/cli.js check <file>` and
  `node src/cli.js snapshot <file>` and look at the frames.
- New APIs, attributes and flags are documented in the skill pack (`skills/givemotion/`), because that is what
  AI agents read.
- One topic per pull request, with a short description of what changed and why.

By contributing you agree that your contribution is licensed under the MIT license of this project.
