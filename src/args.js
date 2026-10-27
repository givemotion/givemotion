// Tiny argument parser: --key value, --key=value, --flag, -o value, positional args.
export function parseArgs(argv, { boolean = [], alias = {} } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && isNaN(Number(a)))) {
      let key = a.replace(/^-+/, '');
      let val;
      const eq = key.indexOf('=');
      if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      key = alias[key] || key;
      key = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key.startsWith('no') && key.length > 2 && val === undefined && boolean.includes(key[2].toLowerCase() + key.slice(3))) { out[key[2].toLowerCase() + key.slice(3)] = false; continue; }
      if (val === undefined) {
        if (boolean.includes(key)) val = true;
        else if (i + 1 < argv.length && !(argv[i + 1].startsWith('--') || (argv[i + 1].startsWith('-') && argv[i + 1].length === 2 && isNaN(Number(argv[i + 1]))))) val = argv[++i];
        else val = true;
      }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

/** --scale: a number (2, 1.5) or a fraction ("4/3": 1440p from a 1080p layout). */
export function parseScale(v) {
  if (v == null || v === '' || v === true) return 1;
  const m = typeof v === 'number' ? null : /^\s*(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?\s*x?\s*$/i.exec(String(v));
  const n = typeof v === 'number' ? v : m ? parseFloat(m[1]) / (m[2] ? parseFloat(m[2]) : 1) : NaN;
  if (!(n > 0) || !isFinite(n)) throw new Error(`Bad --scale "${v}". Use a number like 2 or 1.5, or a fraction like 4/3.`);
  return n;
}
