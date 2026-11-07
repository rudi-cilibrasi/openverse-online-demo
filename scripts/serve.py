#!/usr/bin/env python3
"""A static-only local server. No source text or compilation is sent to it."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8000)
parser.add_argument('--host', default='127.0.0.1')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / 'dist'
if not (root / 'wasm/compiler.wasm').exists():
    parser.error('Build the demo first: ./scripts/build.sh')

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(root)))
print(f'OpenVerse playground: http://{args.host}:{args.port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
