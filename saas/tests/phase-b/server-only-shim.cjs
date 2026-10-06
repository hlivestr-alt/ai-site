// Next resolves this virtual server marker during bundling. Direct server probes
// use its bundled empty server implementation; application builds keep the guard.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node --require preloads CommonJS.
const {registerHooks}=require('node:module');
const marker=require.resolve('next/dist/compiled/server-only/empty.js');
registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==='server-only'?marker:specifier,context);}});
