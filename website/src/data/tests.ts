// Every test shown on the site, with its date and the versions it ran on.
// Source of truth: docs/experiments/*.md in this repository. When a new round lands, add it here.
//
// Versions: npm releases were 0.1.0 (2026-10-31), 0.1.1, 0.1.2, 0.1.3 (2026-11-02) and 0.1.5 (2026-11-09).
// 0.1.4 was never published to npm: rounds 7 and 8 ran on the 0.1.4 development branch, released as 0.1.5.
// Tests from before the first npm release ran on the 0.1.0 development code.

export const REPO = 'https://github.com/givemotion/givemotion';
export const blob = (path: string) => `${REPO}/blob/main/${path}`;
export const SITE = 'https://givemotion.org';

export const LATEST_VERSION = '0.1.5';
export const LATEST_RELEASE_DATE = '2026-11-09';

export type Version = {
  /** What the package.json said when the test ran. */
  label: string;
  /** Extra context, e.g. "development branch, released on npm as 0.1.5". */
  note?: string;
};

export type Score = { name: string; score: number | null; winner?: boolean };

export type Showcase = {
  id: string;
  title: string;
  /** One line on what was tested. */
  kind: string;
  date: string; // ISO, UTC date the test ran
  dateNote?: string;
  givemotion: Version;
  others?: string; // e.g. "Remotion 4.0.539 · HyperFrames 0.8.230"
  models: string;
  summary: string;
  scores?: Score[];
  scoreNote?: string;
  video: { src: string; poster: string; width: number; height: number; seconds: number };
  report: string; // repo path
  group: 'tools' | 'models' | 'docs';
};

export const showcases: Showcase[] = [
  {
    id: 'kinetic',
    title: 'KINETIC, a 20-second motion reel',
    kind: 'One motion-design brief, three tools, same agent',
    date: '2026-11-05',
    givemotion: { label: '0.1.3', note: 'main at 26c811f' },
    others: 'Remotion 4.0.541 · HyperFrames 0.9.15',
    models: 'Claude Opus 5.5, effort high, six blind judges',
    summary:
      'Each tool got a fresh agent with only its own docs. givemotion was first for 5 of 6 judges and wrote 347 lines of code (Remotion 1252, HyperFrames 763). Its first render was the slowest, which led to a speed fix.',
    scores: [
      { name: 'givemotion', score: 7.8, winner: true },
      { name: 'Remotion', score: 7.2 },
      { name: 'HyperFrames', score: 6.2 },
    ],
    video: { src: '/media/kinetic-showcase.mp4', poster: '/media/kinetic-showcase.webp', width: 800, height: 450, seconds: 20 },
    report: 'docs/experiments/2026-11-kinetic-three-engines.md',
    group: 'tools',
  },
  {
    id: 'tools',
    title: 'FLUX, a 20-second opener',
    kind: 'One hard brief, three tools, same agent',
    date: '2026-11-02',
    givemotion: { label: '0.1.2' },
    others: 'Remotion 4.0.539 · HyperFrames 0.8.230',
    models: 'Claude Opus 5.5, effort medium, six blind judges',
    summary:
      'Remotion won this one narrowly on motion and continuity; givemotion led on brief, spec and craft. Render of the 20 s video on a Mac: HyperFrames 11.1 s, givemotion 15.4 s, Remotion 50.6 s.',
    scores: [
      { name: 'Remotion', score: 7.7, winner: true },
      { name: 'givemotion', score: 7.5 },
      { name: 'HyperFrames', score: 6.2 },
    ],
    video: { src: '/media/tools-showcase.mp4', poster: '/media/tools-showcase.webp', width: 800, height: 450, seconds: 24 },
    report: 'docs/experiments/2026-11-tools-showcase.md',
    group: 'tools',
  },
  {
    id: 'city-hive',
    title: '“The City Hive”, a hand-drawn infographic',
    kind: 'Random-brief round 2, brief A',
    date: '2026-11-06',
    givemotion: { label: '0.1.3', note: 'before the fixes this round led to' },
    others: 'Remotion 4.0.541 · HyperFrames 0.9.17',
    models: 'Claude Opus 5.5, effort high, six blind judges',
    summary:
      'A clear loss, shown on purpose. HyperFrames was first for all six judges: it drew the tilted map the brief asked for. givemotion’s agent had to hand-build an ink engine, which led to new sketch tools.',
    scores: [
      { name: 'HyperFrames', score: 8.0, winner: true },
      { name: 'Remotion', score: 6.2 },
      { name: 'givemotion', score: 6.0 },
    ],
    video: { src: '/media/random-briefs.mp4', poster: '/media/random-briefs.webp', width: 720, height: 404, seconds: 16 },
    report: 'docs/experiments/2026-11-random-briefs.md',
    group: 'tools',
  },
  {
    id: 'efforts',
    title: 'Biscuit’s morning walk, at four effort levels',
    kind: 'One model, four effort settings, givemotion only',
    date: '2026-11-02',
    givemotion: { label: '0.1.2' },
    models: 'Claude Opus 5.5 at low, medium, high and xhigh, eight blind judges',
    summary:
      'An illustrated 20 s short with a walk cycle, a gallop and a leap. xhigh was first for 7 of 8 judges; medium was the best value ($4.06 against $14.46).',
    scores: [
      { name: 'xhigh', score: 8.0, winner: true },
      { name: 'medium', score: 6.9 },
      { name: 'high', score: 6.6 },
      { name: 'low', score: 5.3 },
    ],
    video: { src: '/media/efforts-showcase.mp4', poster: '/media/efforts-showcase.webp', width: 640, height: 360, seconds: 25 },
    report: 'docs/experiments/2026-11-efforts-showcase.md',
    group: 'models',
  },
  {
    id: 'models',
    title: '“Code in, motion out”, four Claude models',
    kind: 'One hard brief, four models, givemotion only',
    date: '2026-10-31',
    givemotion: { label: '0.1.1', note: 'development code; 0.1.1 reached npm on 2026-11-02' },
    models: 'Claude Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 (not judged)',
    summary:
      '20 s in one continuous take: a typed <motion> breaks into 3D shapes, a tilted orbiting ring, a collapse into the title. All four delivered all five beats at 1920×1080.',
    video: { src: '/media/models-showcase.mp4', poster: '/media/models-showcase.webp', width: 800, height: 450, seconds: 21 },
    report: 'docs/experiments/2026-10-models-showcase.md',
    group: 'models',
  },
  {
    id: 'lighthouse-opus',
    title: '“The last lighthouse”: Claude Opus 5.5',
    kind: 'Same brief, different models',
    date: '2026-10-27',
    dateNote: 'the day the clips were added to the repository',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Opus 5.5 (not judged)',
    summary: 'A 15 s cinematic title sequence: a night sea, and a light beam that carries into the title.',
    video: { src: '/media/lighthouse-opus.mp4', poster: '/media/lighthouse-opus.webp', width: 400, height: 224, seconds: 15 },
    report: 'README.md',
    group: 'models',
  },
  {
    id: 'lighthouse-sonnet',
    title: '“The last lighthouse”: Claude Sonnet 5.5',
    kind: 'Same brief, different models',
    date: '2026-10-27',
    dateNote: 'the day the clips were added to the repository',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Sonnet 5.5 (not judged)',
    summary: 'The same brief and docs, a different model.',
    video: { src: '/media/lighthouse-sonnet.mp4', poster: '/media/lighthouse-sonnet.webp', width: 400, height: 224, seconds: 15 },
    report: 'README.md',
    group: 'models',
  },
  {
    id: 'lighthouse-haiku',
    title: '“The last lighthouse”: Claude Haiku 5.5',
    kind: 'Same brief, different models',
    date: '2026-10-27',
    dateNote: 'the day the clips were added to the repository',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Haiku 5.5 (not judged)',
    summary: 'The smallest Claude model, same brief and docs.',
    video: { src: '/media/lighthouse-haiku.mp4', poster: '/media/lighthouse-haiku.webp', width: 400, height: 224, seconds: 15 },
    report: 'README.md',
    group: 'models',
  },
  {
    id: 'lighthouse-gemini',
    title: '“The last lighthouse”: Gemini 4 Argon',
    kind: 'Same brief, different models',
    date: '2026-10-27',
    dateNote: 'the day the clips were added to the repository',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Gemini 4 Argon (not judged)',
    summary: 'givemotion is not tied to one model: any agent that reads the docs can use it.',
    video: { src: '/media/lighthouse-gemini.mp4', poster: '/media/lighthouse-gemini.webp', width: 400, height: 224, seconds: 15 },
    report: 'README.md',
    group: 'models',
  },
  {
    id: 'data-story',
    title: 'Data story: the camera rides a growing chart',
    kind: 'Made from the docs alone (round 3 remake)',
    date: '2026-10-24',
    dateNote: 'round 3, October 2026; the date the clip was added',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Opus, three blind judges',
    summary: 'All three judges preferred it to the example it replaced (8.0 against 4.0). The source is in examples/data-story.',
    scores: [{ name: 'new', score: 8.0, winner: true }, { name: 'old example', score: 4.0 }],
    video: { src: '/media/data-story.mp4', poster: '/media/data-story.webp', width: 640, height: 360, seconds: 7 },
    report: 'docs/experiments/2026-10-t2-examples.md',
    group: 'docs',
  },
  {
    id: 'code-explainer',
    title: 'Code explainer for a developer channel',
    kind: 'Made from the docs alone (round 3 remake)',
    date: '2026-10-24',
    dateNote: 'round 3, October 2026; the date the clip was added',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Opus, three blind judges',
    summary: 'A code window that highlights the line being explained. Judges: 7.7 against 4.0 for the old example.',
    scores: [{ name: 'new', score: 7.7, winner: true }, { name: 'old example', score: 4.0 }],
    video: { src: '/media/code-explainer.mp4', poster: '/media/code-explainer.webp', width: 640, height: 360, seconds: 7 },
    report: 'docs/experiments/2026-10-t2-examples.md',
    group: 'docs',
  },
  {
    id: 'vertical-short',
    title: 'Vertical short with word-by-word captions',
    kind: 'Made from the docs alone (round 3 remake)',
    date: '2026-10-24',
    dateNote: 'round 3, October 2026; the date the clip was added',
    givemotion: { label: '0.1.0', note: 'pre-release; first on npm 2026-10-31' },
    models: 'Claude Opus, three blind judges',
    summary: 'For TikTok, Reels and Shorts. Judges: 8.0 against 3.0 for the old example.',
    scores: [{ name: 'new', score: 8.0, winner: true }, { name: 'old example', score: 3.0 }],
    video: { src: '/media/vertical-short.mp4', poster: '/media/vertical-short.webp', width: 300, height: 532, seconds: 7 },
    report: 'docs/experiments/2026-10-t2-examples.md',
    group: 'docs',
  },
];

// ---------------------------------------------------------------- random-brief rounds

export const roundsMeta = {
  date: '2026-11-06',
  method: 'docs/experiments/2026-11-random-briefs.md',
  report78: 'docs/experiments/2026-11-rounds-7-8.md',
  kit: 'docs/experiments/data/2026-11-random-briefs',
  machine: 'one 4-core Linux cloud machine, no GPU',
  models: 'Claude Opus 5.5 at effort high, for makers and judges',
};

/** Judges' mean (1-10) per stage of the random-brief rounds. */
export const trend = [
  { label: 'Rounds 2–6', sub: '10 briefs · givemotion 0.1.3', gm: 6.8, rem: 7.13, hf: 7.02 },
  { label: 'Round 7', sub: '6 sets · givemotion 0.1.4 dev', gm: 7.2, rem: 7.17, hf: 6.3 },
  { label: 'Round 8', sub: '6 sets · givemotion 0.1.4 dev', gm: 7.61, rem: 6.94, hf: 6.75 },
];

export const allSets = [
  { row: 'Latest round (8): judges’ mean, 1–10', gm: '7.61', rem: '6.94', hf: '6.75', best: 'gm' },
  { row: 'Sets won in round 8 (of 6)', gm: '5', rem: '1', hf: '0', best: 'gm' },
  { row: 'All 22 sets: judges’ mean, 1–10', gm: '7.13', rem: '7.09', hf: '6.75', best: 'gm' },
  { row: 'Judges ranking it first, all sets (of 132)', gm: '57', rem: '50', hf: '25', best: 'gm' },
  { row: 'Agent cost at list prices, all 22 sets', gm: '$125', rem: '$105', hf: '$122', best: 'rem' },
  { row: 'Code the agents wrote, all 22 sets', gm: '12,502 lines', rem: '33,257 lines', hf: '26,545 lines', best: 'gm' },
  { row: 'Render time, the 15 briefs timed', gm: '387 s', rem: '1404 s', hf: '1214 s', best: 'gm' },
] as const;

export type RoundSet = {
  set: string;
  brief: string;
  briefFile: string;
  vertical?: boolean;
  gm: number;
  rem: number;
  hf: number;
};

export const rounds: { n: 7 | 8; date: string; versions: string; mean: [number, number, number]; sets: RoundSet[] }[] = [
  {
    n: 8,
    date: '2026-11-06',
    versions: 'givemotion 0.1.4 (development branch, released on npm as 0.1.5) · Remotion 4.0.541 · HyperFrames 0.9.18',
    mean: [7.61, 6.94, 6.75],
    sets: [
      { set: 'N', brief: 'KEYWARD, “One Key” title sequence', briefFile: 'brief-n.md', gm: 7.67, rem: 6.17, hf: 7.5 },
      { set: 'N2', brief: 'KEYWARD, “One Key” title sequence', briefFile: 'brief-n.md', gm: 7.67, rem: 6.33, hf: 6.33 },
      { set: 'O', brief: 'Ledgerline, “Every Dollar Has a Route”', briefFile: 'brief-o.md', gm: 6.83, rem: 7.33, hf: 6.5 },
      { set: 'O2', brief: 'Ledgerline, “Every Dollar Has a Route”', briefFile: 'brief-o.md', gm: 7.83, rem: 6.83, hf: 5.83 },
      { set: 'P', brief: '“Locked Tight”, a year in review', briefFile: 'brief-p.md', vertical: true, gm: 7.83, rem: 7.67, hf: 6.67 },
      { set: 'P2', brief: '“Locked Tight”, a year in review', briefFile: 'brief-p.md', vertical: true, gm: 7.83, rem: 7.33, hf: 7.67 },
    ],
  },
  {
    n: 7,
    date: '2026-11-06',
    versions: 'givemotion 0.1.4 (development branch, released on npm as 0.1.5) · Remotion 4.0.541 · HyperFrames 0.9.18',
    mean: [7.2, 7.17, 6.3],
    sets: [
      { set: 'K', brief: '“The Water Cycle” launch teaser', briefFile: 'brief-k.md', gm: 7.17, rem: 7.33, hf: 6.17 },
      { set: 'K2', brief: '“The Water Cycle” launch teaser', briefFile: 'brief-k.md', gm: 7.5, rem: 6.67, hf: 6.67 },
      { set: 'L', brief: 'ABYSSAL, “Light Ends. Life Doesn’t.”', briefFile: 'brief-l.md', gm: 7.67, rem: 7.17, hf: 6.83 },
      { set: 'L2', brief: 'ABYSSAL, “Light Ends. Life Doesn’t.”', briefFile: 'brief-l.md', gm: 7.67, rem: 7.33, hf: 6.33 },
      { set: 'M', brief: '“The Address of Every Book”', briefFile: 'brief-m.md', vertical: true, gm: 7.17, rem: 7.5, hf: 6.0 },
      { set: 'M2', brief: '“The Address of Every Book”', briefFile: 'brief-m.md', vertical: true, gm: 6.0, rem: 7.0, hf: 5.83 },
    ],
  },
];

export const r8Crops = [
  {
    src: '/media/r8p-1-handover.webp', w: 2952, h: 1216, t: '2.92 s, the hand-over',
    text: 'givemotion’s next card is already drawing under the rising band. Remotion’s and HyperFrames’ frames are almost empty here; the judges named that frame for both.',
  },
  {
    src: '/media/r8p-2-carousel.webp', w: 3312, h: 796, t: '5.75 s, the carousel',
    text: 'Remotion’s is the best: both cards crisp and clearly framed. givemotion’s agent turned motion blur on, and the sliding number smears.',
  },
  {
    src: '/media/r8p-3-rebuild.webp', w: 2772, h: 736, t: '12.0 s, the “37”',
    text: 'The brief asks the number to burst, rebuild, then wipe. givemotion’s has rebuilt on time; the other two are still scattered when the wipe starts.',
  },
  {
    src: '/media/r8p-4-padlock.webp', w: 2592, h: 1036, t: '17.9 s, the last frame',
    text: 'The brief asks for the padlock body around the lower half of the 0. givemotion breaks the body’s edge around the digit; Remotion puts the 0 fully inside (cleanest, but not what was asked); HyperFrames’ edge runs through it.',
  },
];
