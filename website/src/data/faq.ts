// Questions people (and answer engines) ask. Each answer starts with the direct answer in one sentence,
// then the detail. Plain text only: the same strings feed the page and the FAQPage JSON-LD.

export const faq: { q: string; a: string[] }[] = [
  {
    q: 'What is givemotion?',
    a: [
      'givemotion is a free, open-source (MIT) video engine that lets AI agents like Claude Code, Codex and Cursor make motion graphics and render them to MP4.',
      'You describe the video in plain words. The agent writes it as one HTML, CSS and JavaScript page, checks its own frames with givemotion’s check, snapshot and review commands, fixes what is off, and renders the file. Then you ask for changes and only what you asked about changes.',
    ],
  },
  {
    q: 'Is givemotion an AI video generator?',
    a: [
      'No. It does not generate footage from a prompt; your agent builds the video from real pieces (your text, logo, fonts, images, clips and data) and givemotion renders it frame by frame.',
      'That is why the same input gives the same video every time, text is spelled the way you wrote it, and a change touches only what you asked about. It cannot film a photorealistic scene; for that, make a clip with a video model and have the agent put it into a givemotion video.',
    ],
  },
  {
    q: 'Can Claude Code make videos?',
    a: [
      'Yes. Run npx givemotion init my-video (or npx givemotion skill in an existing project) and ask Claude Code for a video.',
      'givemotion installs a skill pack Claude Code reads on its own. It is also a Claude Code plugin (/plugin marketplace add givemotion/givemotion), and it works with Codex, Cursor and other agents that read an AGENTS.md file.',
    ],
  },
  {
    q: 'Is there a free, open-source alternative to Remotion?',
    a: [
      'Yes. givemotion is MIT-licensed and free for any use, including companies of any size; HyperFrames (Apache 2.0) is another.',
      'Remotion uses React and its own source-available license, which is free for individuals and companies of up to 3 people (our summary of its license page as of 27 October 2026, not legal advice). givemotion uses plain HTML and CSS and is built for AI agents to write. In the random-brief rounds of November 2026 it started behind Remotion and led the latest round (7.61 against 6.94).',
    ],
  },
  {
    q: 'How is givemotion different from HyperFrames?',
    a: [
      'Both are free and both use HTML; givemotion re-renders only what changed, has zero npm dependencies, sends no usage data, needs no account and is independent of any company.',
      'HyperFrames, by HeyGen, has far more features today (cloud rendering, a desktop app, voice and transcription tools, HDR output) and a much larger community.',
    ],
  },
  {
    q: 'Do I need to know how to code?',
    a: [
      'No. You talk to your agent in plain words and it does the rest, including the setup if you ask it to.',
      'The video is code so that every change can be exact. You never have to read it; if you know HTML and CSS, you can open the file and change anything.',
    ],
  },
  {
    q: 'How much does givemotion cost?',
    a: [
      'givemotion is free. You pay for your AI agent as you already do, and rendering runs on your own computer with no fee per video.',
      'Because a change re-renders only the 1–2 second parts of the video it touches, revisions stay cheap and fast.',
    ],
  },
  {
    q: 'Can I use it for client work or sell what I make?',
    a: [
      'Yes, for free, at any company size, under the MIT license.',
      'You can also embed givemotion in your own product, run it on your servers, or fork it and sell the fork. The only condition is that the license notice stays in.',
    ],
  },
  {
    q: 'If I change one thing, does the whole video render again?',
    a: [
      'No. A render is split into 1–2 second parts, each with a fingerprint of everything that affects its pixels, and only the parts whose fingerprint changed are rendered again.',
      'The result is byte-identical to a full render, so a small fix usually takes seconds.',
    ],
  },
  {
    q: 'What do I need to install?',
    a: [
      'Node.js 20 or newer and ffmpeg; givemotion downloads Chrome for you (npx givemotion install).',
      'givemotion itself has zero npm dependencies, so installing it adds one package. It runs on macOS, Linux and Windows, and works offline once Chrome is installed.',
    ],
  },
  {
    q: 'Can I add my own music, voice-over, logo and video clips?',
    a: [
      'Yes. Audio tracks with volume curves and ducking under a voice, video clips, images, your own fonts, and captions from a word-timed file or an .srt are all supported.',
      'Cuts and pulses can land on the music’s beats: givemotion analyzes the song’s tempo and beats for the agent.',
    ],
  },
  {
    q: 'What can’t givemotion do yet?',
    a: [
      'It has no cloud rendering, no visual editor, no built-in voice or transcription tools, and no HDR or HLS output.',
      'It renders on your machine or your server. Pages with many full-screen effects render slowly without a GPU, and it is young (0.x), so options may still change.',
    ],
  },
  {
    q: 'How were the comparisons with Remotion and HyperFrames run?',
    a: [
      'Briefs were drawn at random and written by a session that did not know the tools; each tool was used by a fresh Claude Opus 5.5 agent that saw only its own official docs; six blind AI judges scored each set.',
      'All makers ran on the same 4-core Linux machine without a GPU. Every round is reported, including the ones givemotion lost, with versions, dates, prompts, raw scores and the harness in the repository so anyone can rerun it. It is a running record with AI judges looking at frames, not a final benchmark.',
    ],
  },
  {
    q: 'Who made givemotion?',
    a: [
      'Leonardo Grigorio started givemotion in 2026 as an independent open-source project, not tied to any company.',
      'It improves in rounds: fresh agents make real videos from the docs, and where they struggle becomes engine fixes. Issues and pull requests are welcome on GitHub.',
    ],
  },
];
