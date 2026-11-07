#!/usr/bin/env python3
"""Cross-compile OpenVerse and the pinned Lean runtime, never the Lean prover.

Lean's release source contains generated standard-library C in stage0/stdlib.
Only the import closure of our small compiler entry point is needed. All object
files are cached by content/compiler/flags so rebuilding the webpage is cheap.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import os
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / '.build'
OV = BUILD / 'openverse'
LEAN = BUILD / 'lean4'
OUT = ROOT / 'dist' / 'wasm'
CACHE = BUILD / 'objects'
INC = BUILD / 'include'
for directory in (OUT, CACHE, INC / 'lean'):
    directory.mkdir(parents=True, exist_ok=True)

# Do not use the native toolchain's config.h: it enables its native allocator.
(INC / 'lean' / 'config.h').write_text('#pragma once\n#include <lean/version.h>\n#define LEAN_IS_STAGE0 0\n')
prefix = Path(subprocess.check_output(['lake', 'env', 'lean', '--print-prefix'], cwd=OV, text=True).strip())
shutil.copyfile(prefix / 'include/lean/version.h', INC / 'lean/version.h')
(INC / 'githash.h').write_text('#define LEAN_GITHASH "293d5d0c0c3f3dded4688b3ccd6a33939ac5102b"\n')
# Headers only; no host libuv binary is ever linked into WASM.
if not Path('/usr/include/uv.h').exists():
    sys.exit('Missing libuv headers. Run ./scripts/install-deps.sh (libuv1-dev).')
shutil.copyfile('/usr/include/uv.h', INC / 'uv.h')
shutil.copytree('/usr/include/uv', INC / 'uv', dirs_exist_ok=True)

common = ['-O1', '-DNDEBUG', '-DLEAN_EMSCRIPTEN', '-I' + str(INC),
          '-I' + str(LEAN / 'src/include'), '-I' + str(LEAN / 'src')]
version = subprocess.check_output(['emcc', '--version'])
headers = hashlib.sha256()
for directory in (INC, LEAN / 'src/include', LEAN / 'src/runtime'):
    for path in sorted(directory.rglob('*.h')):
        headers.update(path.read_bytes())
salt = version + headers.digest()

def compile_object(spec):
    source, cxx, extra = spec
    compiler = 'em++' if cxx else 'emcc'
    flags = common + (['-std=c++20', '-fexceptions', '-include', str(ROOT / 'wasm/libcxx-compat.h')] if cxx else []) + extra
    key = hashlib.sha256(salt + source.read_bytes() + ((ROOT / 'wasm/libcxx-compat.h').read_bytes() if cxx else b'') + repr((compiler, flags)).encode()).hexdigest()
    target = CACHE / (key + '.o')
    if not target.exists():
        proc = subprocess.run([compiler, *flags, '-c', str(source), '-o', str(target)], capture_output=True, text=True)
        if proc.returncode:
            target.unlink(missing_ok=True)
            raise RuntimeError(f'{source}:\n{proc.stderr}')
    return target

# Follow imports in generated C, including initialization-only modules.
visited = set()
sources = []
def visit(source):
    if source in visited:
        return
    visited.add(source)
    if not source.exists():
        raise RuntimeError(f'Missing generated C: {source}')
    sources.append(source)
    with source.open() as stream:
        header = ''.join(next(stream) for _ in range(3))
    for module in re.findall(r'(?:\bimport )(?:all )?([\w.]+)', header):
        relative = Path(*module.split('.')).with_suffix('.c')
        visit((OV / '.lake/build/ir' if module.startswith('OpenVerse') else LEAN / 'stage0/stdlib') / relative)

visit(BUILD / 'Compiler.c')
runtime_names = re.search(r'RUNTIME_OBJS\s+(.*?)\n\)', (LEAN / 'src/runtime/CMakeLists.txt').read_text(), re.S).group(1).split()
specs = [(source, False, []) for source in sources]
specs += [(LEAN / 'src/runtime' / name, True, []) for name in runtime_names]
specs.append((ROOT / 'wasm/compiler.c', False, []))
specs.append((ROOT / 'wasm/uv-errors.c', False, []))
print(f'Compiling {len(sources)} Lean C modules and {len(runtime_names)} runtime files', flush=True)
with ThreadPoolExecutor(max_workers=int(os.environ.get('JOBS', min(8, os.cpu_count() or 1)))) as pool:
    futures = [pool.submit(compile_object, spec) for spec in specs]
    objects, errors = [], []
    for future in futures:
        try:
            objects.append(future.result())
        except RuntimeError as error:
            errors.append(str(error))
    if errors:
        sys.exit('\n'.join(errors))

def run(command):
    if subprocess.run(command).returncode:
        sys.exit(f'{command[0]} failed; see the diagnostics above.')

link = ['-O2', '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864',
        '-sMAXIMUM_MEMORY=536870912', '-sTOTAL_STACK=16777216', '-sENVIRONMENT=web,worker,node',
        '-sEXPORTED_RUNTIME_METHODS=["cwrap"]', '-sASSERTIONS=1', '-Wl,--fatal-warnings']
run(['em++', *map(str, objects), *link, '-sDISABLE_EXCEPTION_CATCHING=0',
                '-sEXPORT_NAME=VerseCompiler', '-o', str(OUT / 'compiler.js')])

# Every runtime source except the native command line (main.c), so that a new
# runtime file (floats.c, say) needs no change here.
runtime_sources = sorted(p for p in (OV / 'runtime/src').glob('*.c') if p.name != 'main.c')
run(['emcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
                '-I' + str(OV / 'runtime/include'), *map(str, runtime_sources), str(ROOT / 'wasm/runtime.c'),
                *link, '-sEXPORT_NAME=VerseRuntime', '-sEXPORTED_FUNCTIONS=["_run_bytecode","_malloc","_free"]',
                '-o', str(OUT / 'runtime.js')])
print('Built dist/wasm/{compiler,runtime}.{js,wasm}', flush=True)
