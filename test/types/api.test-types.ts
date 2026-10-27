// Compile-time test (run by `npm run typecheck`): the functions in src/ must still match the public declarations in
// src/types/api.d.ts, which is what TypeScript users of the package see. If this fails, update one or the other.
import * as impl from '../../src/api.js';
import type * as decl from '../../src/types/api.js';

export const api: {
  render: typeof decl.render;
  stills: typeof decl.stills;
  still: typeof decl.still;
  check: typeof decl.check;
  snapshot: typeof decl.snapshot;
  formatReport: typeof decl.formatReport;
  inspect: typeof decl.inspect;
  openComposition: typeof decl.openComposition;
  resolveInput: typeof decl.resolveInput;
  startServer: typeof decl.startServer;
  expandIncludes: typeof decl.expandIncludes;
  injectRuntime: typeof decl.injectRuntime;
  findChrome: typeof decl.findChrome;
  installChrome: typeof decl.installChrome;
  ensureChrome: typeof decl.ensureChrome;
  FramePage: typeof decl.FramePage;
} = impl;
