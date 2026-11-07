/* Both the Lean front end and C interpreter execute in this service worker.
   No fetch handler: running Verse cannot delay normal page asset requests. */
importScripts('wasm/compiler.js', 'wasm/runtime.js');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

class RunnerLoadError extends Error {}
// Keep the bytes, not the mutable WASM instances. Once loaded, subsequent runs
// in this worker need no network access, including runs with invalid source.
const wasmBytes = new Map();
function loadWasm(filename, label) {
  if (!wasmBytes.has(filename)) {
    const promise = (async () => {
      const url = new URL(`wasm/${filename}`, self.registration.scope);
      let response;
      let bytes;
      try {
        response = await fetch(url);
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new RunnerLoadError(`Could not load the ${label} (${filename}).\nCheck your connection and make sure the demo server is running, then try again.`);
      }
      if (!response.ok) {
        throw new RunnerLoadError(`Could not load the ${label}: ${filename} returned HTTP ${response.status}.\nThe demo's files are missing or unavailable. Rebuild the demo or contact its host, then try again.`);
      }
      if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109) {
        throw new RunnerLoadError(`Could not load the ${label}: ${filename} is not a valid WebAssembly file.\nRebuild and serve the complete demo, then reload this page.`);
      }
      return bytes;
    })();
    wasmBytes.set(filename, promise);
    // A failed download must be retried once the server/network is repaired.
    promise.catch(() => wasmBytes.delete(filename));
  }
  return wasmBytes.get(filename);
}

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
  let stage = 'validating';
  try {
    const { source, args = '', fuel = 100000 } = request;
    if (typeof source !== 'string' || typeof args !== 'string' ||
        new TextEncoder().encode(source).length > 65536 ||
        new TextEncoder().encode(args).length > 16384 ||
        !Number.isInteger(fuel) || fuel < 1 || fuel > 1000000) {
      throw new Error('Use at most 64 KiB of source, 16 KiB of arguments, and 1–1,000,000 steps.');
    }
    stage = 'loading';
    send({ type: 'phase', phase: 'Loading compiler…' });
    const compilerBytes = await loadWasm('compiler.wasm', 'Verse compiler');
    // A fresh instance per run releases all Lean/C heap state after completion.
    const compiler = await VerseCompiler({ wasmBinary: compilerBytes, print: () => {},
      printErr: text => send({ type: 'stderr', text }) });
    stage = 'compiling';
    send({ type: 'phase', phase: 'Compiling…' });
    const code = compiler.cwrap('compile_verse', 'number', ['string', 'string'])(source, args);
    const size = compiler.cwrap('compiled_size', 'number', [])();
    const ptr = compiler.cwrap('compiled_data', 'number', [])();
    const bytes = compiler.HEAPU8.slice(ptr, ptr + size);
    if (code !== 0) {
      send({ type: code === 4 ? 'diagnostic' : 'stderr',
        text: new TextDecoder().decode(bytes) || 'The source compiler could not initialize. Reload the page or rebuild the demo.' });
      send({ type: 'done', code, errorKind: code === 4 ? 'source' : 'loading', duration: performance.now() - start });
      return;
    }
    stage = 'loading';
    send({ type: 'phase', phase: 'Loading runtime…' });
    const runtimeBytes = await loadWasm('runtime.wasm', 'Verse runtime');
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
    const runtime = await VerseRuntime({ wasmBinary: runtimeBytes,
      print: text => output('stdout', text), printErr: text => output('stderr', text) });
    stage = 'running';
    send({ type: 'phase', phase: 'Running…' });
    const data = runtime._malloc(bytes.length);
    if (!data) throw new Error('Cannot allocate bytecode memory.');
    let exitCode;
    try {
      runtime.HEAPU8.set(bytes, data);
      exitCode = runtime.cwrap('run_bytecode', 'number', ['number', 'number', 'number'])(data, bytes.length, fuel);
    } finally { runtime._free(data); }
    send({ type: 'done', code: exitCode, duration: performance.now() - start });
  } catch (error) {
    const loading = stage === 'loading';
    send({ type: 'stderr', text: loading ? error.message || String(error) : `Unable to run: ${error.message || error}` });
    send({ type: 'done', code: 2, errorKind: loading ? 'loading' : 'runtime', duration: performance.now() - start });
  } finally { port.close(); }
}
