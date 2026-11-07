/* Both the Lean front end and C interpreter execute in this service worker.
   No fetch handler: running Verse cannot delay normal page asset requests. */
importScripts('wasm/compiler.js', 'wasm/runtime.js');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Runs are serialized across tabs to bound memory to one pair of instances.
let queue = Promise.resolve();
self.addEventListener('message', event => {
  const port = event.ports[0];
  if (!port) return;
  if (event.data?.type === 'ping') {
    port.postMessage({ type: 'ready', context: self.constructor.name });
    return;
  }
  if (event.data?.type !== 'run') return;
  const task = queue.then(() => execute(event.data, port));
  queue = task.catch(() => {});
  event.waitUntil(task);
});

async function execute(request, port) {
  const start = performance.now();
  const send = data => port.postMessage(data);
  try {
    const { source, args = '', fuel = 100000 } = request;
    if (typeof source !== 'string' || typeof args !== 'string' ||
        new TextEncoder().encode(source).length > 65536 ||
        new TextEncoder().encode(args).length > 16384 ||
        !Number.isInteger(fuel) || fuel < 1 || fuel > 1000000) {
      throw new Error('Use at most 64 KiB of source, 16 KiB of arguments, and 1–1,000,000 steps.');
    }
    send({ type: 'phase', phase: 'Compiling…' });
    const locateFile = filename => new URL(`wasm/${filename}`, self.registration.scope).href;
    // A fresh instance per run releases all Lean/C heap state after completion.
    const compiler = await VerseCompiler({ locateFile, print: () => {}, printErr: text => send({ type: 'stderr', text }) });
    const code = compiler.cwrap('compile_verse', 'number', ['string', 'string'])(source, args);
    const size = compiler.cwrap('compiled_size', 'number', [])();
    const ptr = compiler.cwrap('compiled_data', 'number', [])();
    const bytes = compiler.HEAPU8.slice(ptr, ptr + size);
    if (code !== 0) {
      send({ type: 'stderr', text: new TextDecoder().decode(bytes) || 'The source compiler could not initialize.' });
      send({ type: 'done', code, duration: performance.now() - start });
      return;
    }
    send({ type: 'phase', phase: 'Running…' });
    let outputBytes = 0;
    let truncated = false;
    function output(type, text) {
      if (outputBytes > 131072) {
        if (!truncated) { send({ type: 'stderr', text: 'Display truncated after 128 KiB of output.' }); truncated = true; }
        return;
      }
      outputBytes += text.length;
      send({ type, text });
    }
    const runtime = await VerseRuntime({ locateFile,
      print: text => output('stdout', text), printErr: text => output('stderr', text) });
    const data = runtime._malloc(bytes.length);
    if (!data) throw new Error('Cannot allocate bytecode memory.');
    let exitCode;
    try {
      runtime.HEAPU8.set(bytes, data);
      exitCode = runtime.cwrap('run_bytecode', 'number', ['number', 'number', 'number'])(data, bytes.length, fuel);
    } finally { runtime._free(data); }
    send({ type: 'done', code: exitCode, duration: performance.now() - start });
  } catch (error) {
    send({ type: 'stderr', text: `Unable to run: ${error.message || error}` });
    send({ type: 'done', code: 2, duration: performance.now() - start });
  } finally { port.close(); }
}
