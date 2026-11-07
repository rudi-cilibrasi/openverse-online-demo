#!/usr/bin/env python3
"""Fetch immutable GitHub source revisions without touching sibling checkouts."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
for name, spec in json.loads((root / 'sources.json').read_text()).items():
    target = root / '.build' / name
    if not (target / '.git').exists():
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'init', '-q', str(target)], check=True)
        subprocess.run(['git', '-C', str(target), 'remote', 'add', 'origin', spec['url']], check=True)
    def git(*args, **kwargs):
        return subprocess.run(['git', '-C', str(target), *args], check=True, **kwargs)
    current = subprocess.run(['git', '-C', str(target), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    if current.stdout.strip() != spec['commit']:
        dirty = git('status', '--porcelain', '--untracked-files=no', capture_output=True, text=True).stdout
        if dirty:
            raise SystemExit(f'{target} has changes; preserve/remove this build checkout before changing its revision.')
        git('fetch', '--depth=1', 'origin', spec['commit'])
        git('checkout', '--detach', spec['commit'])
    print(f'{name}: {spec["commit"]}', flush=True)

# A compatibility fix for the pinned upstream's two obsolete String API calls.
# It is idempotent; no dependency installer is copied into OpenVerse.
for name in ('openverse', 'lean4'):
    for patch in sorted((root / 'patches' / name).glob('*.patch')):
        cmd = ['git', '-C', str(root / '.build' / name), 'apply']
        if subprocess.run([*cmd, '--reverse', '--check', str(patch)], capture_output=True).returncode:
            subprocess.run([*cmd, '--check', str(patch)], check=True)
            subprocess.run([*cmd, str(patch)], check=True)
