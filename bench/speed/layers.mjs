// How many composited layers a frame has, how much of the frame they cover (clipped to the frame), how many render
// passes it takes, and which elements cost most. The same report `motionwright bench` prints, with more detail.
// node bench/speed/layers.mjs video.html [time ...]   (no times: 12 times spread over the video)
import { layerReport, formatLayerReport } from '../../src/bench.js';
const [file, ...at] = process.argv.slice(2);
const r = await layerReport(file, { times: at.length ? at.map(Number) : undefined, samples: 12, top: 12 });
console.log(formatLayerReport(r).join('\n'));
