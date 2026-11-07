# OpenVerse online demo

[![test](https://github.com/rudi-cilibrasi/openverse-online-demo/actions/workflows/test.yml/badge.svg)](https://github.com/rudi-cilibrasi/openverse-online-demo/actions/workflows/test.yml)

**Try it: <https://rudi-cilibrasi.github.io/openverse-docs/demo/>**, published
with the openverse books by [openverse-docs](https://github.com/rudi-cilibrasi/openverse-docs),
which includes this repository as its `demo/` submodule.

An editable Verse playground that compiles and runs entirely in a browser.
It fetches [rudi-cilibrasi/openverse](https://github.com/rudi-cilibrasi/openverse.git),
builds its Lean source compiler and C runtime as two WebAssembly modules, and
runs **both inside a service worker**, away from the GUI thread. The server only
serves static files; it never receives user programs.

## Build and run on Ubuntu / Debian

```sh
./scripts/install-deps.sh
export PATH="$HOME/.elan/bin:$PATH"
./scripts/build.sh
python3 scripts/serve.py
```

Open **http://localhost:8000**. Installation uses `sudo apt-get` for Emscripten,
C/C++ build tools, Python, curl, and libuv headers, plus elan if missing. Elan
installs the Lean version declared by the fetched OpenVerse `lean-toolchain`.
All dependency installation belongs to this repository. OpenVerse receives no
Emscripten installer and no system changes.

The first build fetches Lean's source (including its generated standard-library
C) and compiles about 800 small modules. Allow several minutes and a few GiB of
disk space. Later builds reuse content-addressed WASM object files. Set `JOBS=4`
to reduce parallel compiler processes on a small machine; the default is at
most eight. `git`, `python3`, `lake`, `emcc`, and `em++` must be on `PATH`.
The build does not require Node or npm; they are only used by browser tests.

Upstream and Lean commits are pinned in [sources.json](sources.json), and recorded
in `dist/build-info.json`. Checkouts, native intermediate files, and cached WASM
objects live under `.build/`; outputs live under `dist/`. Both are ignored by
Git. The scripts use their own checkouts and leave sibling repositories alone.
OpenVerse itself builds for WebAssembly unpatched (since
[openverse#124](https://github.com/rudi-cilibrasi/openverse/pull/124)). Any patch
placed in `patches/openverse/` or `patches/lean4/` is applied idempotently to that
build checkout; today only Lean's runtime needs one.

The pinned Lean runtime also needs [target compatibility fixes](patches/lean4/wasm-runtime.patch):
a WASM stub signature, two obsolete FFI world parameters, and exclusion of
Unix signal-stack setup (WASM uses checked linear memory). The demo supplies a
C++20 `bit_cast` fallback for Emscripten 3.1.6's old libc++ and derives the small
`uv_strerror` function from libuv's public error map. Networking and filesystem
APIs are not exposed to Verse programs.

To rebuild from scratch, remove `.build/` and `dist/` and run the build again.
To update upstream, update the commit pins, check the compatibility patches,
and remove `.build/openverse/` and `.build/lean4/` before rebuilding both modules
together. Object caches can be retained. The fetcher refuses to overwrite the
patched build checkouts when their revision changes. Changing Lean also requires checking the Lean
runtime adapter and rerunning the browser tests.

## Try it

Choose an example, edit `Main.verse`, then click **Run code** (or Ctrl/⌘+Enter).
The examples cover output, loops, failure contexts and rollback, classes behind
an interface with overloading and a generic function, and arguments.

```verse
Main():void =
    if (Name := Args[0]):
        Print("Hello, {Name}!")
    else:
        Print("Hello, Verse!")
```

A link can open a program: `…/demo/#code=SOURCE&args=ARGS`, with `SOURCE` and
`ARGS` percent-encoded (arguments one per line, optional). **Copy link** makes
such a link for the program in the editor. The fragment stays in the browser,
like the program itself; once loaded it is cleared from the address bar, so a
reload keeps later edits.

Open **Program arguments** and enter one argument per line. The interpreter
receives these through OpenVerse's existing `Args:[]string` support. Empty input
means no arguments. Input is supplied before each run; there is no interactive
stdin, mouse API, graphics, or filesystem import support. Source and arguments
are saved in browser local storage when available.

Compiler errors include the filename, one-based line and column, the offending
source line, and a caret. Download problems have separate messages naming the
missing compiler/runtime file, its HTTP status when available, and recovery
steps. Successful WASM downloads are retained for the service worker's lifetime,
so subsequent runs in that worker can report syntax errors and execute programs
without another download. This cache is in memory; the browser may stop idle
service workers, so it is not a guarantee of offline operation after a reload.

## How it works

1. `scripts/fetch-sources.py` fetches the exact GitHub revisions and applies the
   patches in `patches/`. `build.sh` uses upstream's own lexer, parser, elaborator,
   and checks to generate C with its pinned native Lean toolchain.
2. `wasm/Compiler.lean` exposes upstream parsing, `Front.compileTops`, and OVBC encoding. A small C
   adapter exposes the compiler's byte buffer to JavaScript. No reimplementation
   of Verse syntax is involved.
3. `scripts/build-wasm.py` cross-compiles the generated C, its standard-library
   import closure, and Lean's actual C++ runtime using Emscripten. It uses Lean's
   built-in arbitrary-precision arithmetic and allocator, rather than native
   libraries or a simplified replacement runtime. Host libuv headers provide
   declarations only; host binaries are never linked into WASM.
4. The same script builds OpenVerse's seven C runtime source files with
   `wasm/runtime.c`. It bypasses the native CLI's pthread stack allocation and
   uses a fixed 16 MiB WASM stack, with conservative runtime recursion limits.
5. `web/service-worker.js` receives source over a `MessageChannel`, instantiates
   the compiler, transfers bytecode to the C runtime, and returns output and
   diagnostics. Each run has fresh WASM instances. Runs are serialized across
   tabs to bound memory use. There is no `fetch` handler, so evaluating a program
   cannot hold up ordinary page asset requests.

Both modules are single-threaded. No SharedArrayBuffer or COOP/COEP headers are
required. The page never instantiates WASM. The UI remains responsive during
compilation and execution. Service workers require **HTTPS or localhost**;
opening `dist/index.html` as a `file:` URL will show a useful error.

Print output follows OpenVerse's transactional semantics: it is buffered until
a run completes, and output inside a failed condition is rolled back. A resource
limit suppresses the partial output, matching the native runtime. This is not a
live-streaming terminal. Exit results preserve upstream's protocol: 0 success,
1 failure, 2 runtime error, 3 resource limit, 4 compile/load error.

The selectable step limit also sets `max_steps`, which bounds total evaluator
work independently of semantic fuel. The browser adapter caps output at 128 KiB,
heap cells at 2²², slots/journal/value stack at 2¹⁸ each, and recursive evaluation
depth at 1,000. Each module can grow to 512 MiB. Source is limited to 64 KiB and
arguments to 16 KiB. Browser-managed service worker lifetimes still apply;
pathological compiler inputs may be terminated by the browser. The page reports
missing responses after 60 seconds. There is no claim of hard interruption or a
Stop button: a service worker cannot be forcibly terminated by page JavaScript.

## Serve elsewhere

Deploy the **contents of `dist/` together** to any HTTPS static host. Relative
paths support hosting below a subdirectory. Keep the service worker beside
`index.html`, preserve the `wasm/` subdirectory, and serve `.wasm` as
`application/wasm`. Use revalidation (`Cache-Control: no-cache`) for the service
worker, JavaScript, and WASM assets so a new build does not mix versions.
Hosts that cannot set headers still work: the service worker revalidates the
WASM modules whenever it starts (`fetch(…, { cache: 'no-cache' })`, a 304 when
unchanged), so GitHub Pages' ten-minute `max-age` cannot pair a new worker with
an old module.
There is no backend compiler or third-party CDN dependency.

## Verify

CI (`.github/workflows/test.yml`) builds the playground from source and runs
the browser tests on every push and pull request; the built `dist/` is the
run's `playground` artifact. Locally, after building:

```sh
npm ci
npx playwright install chromium
npm test
# Or use an existing Chrome/Chromium:
CHROMIUM_PATH=/usr/bin/google-chrome npm test
```

The browser suite exercises edited source through real WASM, every example,
Unicode arguments, transactional rollback, compiler/runtime errors and recovery,
bounded infinite loops, GUI responsiveness, local storage, keyboard execution,
a mobile viewport, source diagnostics while offline, and recovery from missing
compiler/runtime downloads. It also checks that the main page makes zero WebAssembly
compilation/instantiation calls and that the runner is an actual
`ServiceWorkerGlobalScope`.

OpenVerse is an independent implementation of a subset of Verse. Verse, Unreal
Engine and Fortnite are trademarks of Epic Games. This demo is not affiliated
with Epic Games; see upstream's [language coverage](https://github.com/rudi-cilibrasi/openverse/blob/main/docs/LANGUAGE.md).
