const { test, expect } = require('@playwright/test');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#run')).toBeEnabled({ timeout: 30000 });
}
async function run(page, source, expectedStatus = 'Finished') {
  if (source !== undefined) await page.locator('#source').fill(source);
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText(expectedStatus, { timeout: 60000 });
  return page.locator('#output').textContent();
}

test('real browser compiles edited Verse and runs both WASM modules in a service worker', async ({ page }) => {
  await page.addInitScript(() => {
    window.wasmCalls = 0;
    for (const name of ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming']) {
      const original = WebAssembly[name];
      WebAssembly[name] = (...args) => { window.wasmCalls++; return original(...args); };
    }
  });
  await ready(page);
  expect(await run(page)).toBe('Hello, Verse!\nA small idea, brought to life.');
  expect(await run(page, 'Main():void =\n    Print("Edited source: {6 * 7}")\n')).toBe('Edited source: 42');
  expect(await page.evaluate(() => window.wasmCalls)).toBe(0);
  const context = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { resolve(event.data.context); channel.port1.close(); };
      registration.active.postMessage({ type: 'ping' }, [channel.port2]);
    });
  });
  expect(context).toBe('ServiceWorkerGlobalScope');
});

test('all examples, text arguments, and transactional rollback', async ({ page }) => {
  await ready(page);
  await page.selectOption('#example', 'rollback');
  expect(await run(page)).toBe('The condition failed; the change rolled back.\nAttempts = 0');
  await page.selectOption('#example', 'loops');
  expect(await run(page)).toBe('2 / 2 = 1\n4 / 2 = 2\n6 / 2 = 3\n8 / 2 = 4\n10 / 2 = 5');
  await page.selectOption('#example', 'shapes');
  expect(await run(page)).toBe('a square of area 9\na rectangle of area 10\n2 shapes\ntotal area: 19\nthe last is a rectangle');
  await page.selectOption('#example', 'args');
  await page.locator('#args').fill('Zoë 🌱\nVerse');
  expect(await run(page)).toBe('Hello, Zoë 🌱!\nYou said: Zoë 🌱\nYou said: Verse');
});

test('syntax, type and runtime errors recover on the next run', async ({ page }) => {
  await ready(page);
  await run(page, 'using{"missing.verse"}\nMain():void = {}\n', 'Check your source');
  await expect(page.locator('#output')).toContainText('filesystem imports are unavailable');
  await run(page, 'Main(:void = ???', 'Check your source');
  await expect(page.locator('#output')).not.toBeEmpty();
  await run(page, 'Main():void =\n    Print(UnknownName)\n', 'Check your source');
  await expect(page.locator('#output')).toContainText('UnknownName');
  await run(page, 'Main():void =\n    Err()\n', 'Runtime error');
  await expect(page.locator('#output')).toContainText('error: user');
  expect(await run(page, 'Main():void =\n    Print("Recovered")\n')).toBe('Recovered');
});

test('infinite loop is bounded, GUI stays responsive, and another run succeeds', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    window.ticks = 0;
    window.timer = setInterval(() => window.ticks++, 10);
  });
  await page.selectOption('#fuel', '1000000');
  const output = await run(page, 'Main():void =\n    loop:\n        1 + 1\n', 'Step or resource limit');
  expect(output).toContain('limit:');
  expect(await page.evaluate(() => { clearInterval(window.timer); return window.ticks; })).toBeGreaterThan(2);
  expect(await run(page, 'Main():void =\n    Print("Still here")\n')).toBe('Still here');
});

test('source and arguments survive reload; mobile page fits and keyboard runs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.selectOption('#example', 'args');
  await page.locator('#args').fill('Saved');
  await page.locator('#source').fill('Main():void =\n    Print("Saved program")\n');
  await page.reload();
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#args')).toHaveValue('Saved');
  await expect(page.locator('#source')).toHaveValue('Main():void =\n    Print("Saved program")\n');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#source').press('Control+Enter');
  await expect(page.locator('#status')).toHaveText('Finished', { timeout: 60000 });
  await expect(page.locator('#output')).toHaveText('Saved program');
});

test('a link opens a program with its arguments, and Copy link makes one', async ({ page, context }) => {
  const program = '# Grüße aus dem Link\nMain():void =\n    if (A := Args[0]):\n        Print("Hello, {A}: {Args.Length} argument")\n';
  await page.goto('/#' + new URLSearchParams({ code: program, args: 'zwölf' }));
  await expect(page.locator('#run')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#source')).toHaveValue(program);
  await expect(page.locator('#args')).toHaveValue('zwölf');
  expect(new URL(page.url()).hash).toBe('');
  expect(await run(page)).toBe('Hello, zwölf: 1 argument');
  await page.reload();
  await expect(page.locator('#source')).toHaveValue(program);
  // A link followed while the page is open replaces the program too.
  await page.evaluate(() => { location.hash = 'code=' + encodeURIComponent('Main():void = Print("again")'); });
  await expect(page.locator('#source')).toHaveValue('Main():void = Print("again")');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(page.locator('#args')).toBeHidden(); // that link had no arguments
  await page.locator('#arguments summary').click();
  await page.locator('#args').fill('a b+c');
  await page.locator('#share').click();
  await expect(page.locator('#share')).toHaveText('Link copied');
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const params = new URLSearchParams(copied.hash.slice(1));
  expect(params.get('code')).toBe('Main():void = Print("again")');
  expect(params.get('args')).toBe('a b+c');
});

test('static hosting under a subdirectory preserves service worker scope and WASM paths', async ({ page }) => {
  const fs = require('node:fs');
  fs.symlinkSync('.', 'dist/nested-demo', 'dir');
  try {
    await page.goto('/nested-demo/');
    await expect(page.locator('#run')).toBeEnabled({ timeout: 30000 });
    expect(await run(page)).toBe('Hello, Verse!\nA small idea, brought to life.');
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toContain('/nested-demo/');
  } finally { fs.unlinkSync('dist/nested-demo'); }
});

test('syntax diagnostics show the source location and keep working after the server disconnects', async ({ page, context }) => {
  await ready(page);
  await run(page);
  await context.setOffline(true);
  try {
    const output = await run(page, 'Main():void =\n    Print("missing quote)\n', 'Check your source');
    expect(output).toContain('Main.verse:2:26: unterminated string literal');
    expect(output).toContain('2 |     Print("missing quote)');
    expect(output).toContain('^');
    expect(output).not.toContain('fetch');
    const unknown = await run(page, 'Main():void =\n    Print(UnknownName)\n', 'Check your source');
    expect(unknown).toContain('Main.verse:2:11: unknown identifier');
    expect(unknown.split('\n').at(-1)).toBe('  |           ^');
    expect(await run(page, 'Main():void =\n    Print("Offline recovery")\n')).toBe('Offline recovery');
  } finally { await context.setOffline(false); }
});

test('missing compiler download is explained and retried after repair', async ({ page, context }) => {
  await context.route('**/wasm/compiler.wasm', route => route.fulfill({ status: 404, body: 'Not found' }));
  await ready(page);
  const missing = await run(page, 'Main(:void = ???', 'Runner unavailable');
  expect(missing).toContain('Could not load the Verse compiler');
  expect(missing).toContain('compiler.wasm returned HTTP 404');
  expect(missing).toContain('Rebuild the demo');
  await context.unroute('**/wasm/compiler.wasm');
  const syntax = await run(page, 'Main(:void = ???', 'Check your source');
  expect(syntax).toContain('Main.verse:1:6: expected an identifier');
  expect(syntax).toContain('1 | Main(:void = ???');
});

test('runtime download errors are distinct from source errors and recover after repair', async ({ page, context }) => {
  await context.route('**/wasm/runtime.wasm', route => route.abort('failed'));
  await ready(page);
  expect(await run(page, 'Main(:void = ???', 'Check your source')).toContain('expected an identifier');
  const missing = await run(page, 'Main():void =\n    Print("Recovered")\n', 'Runner unavailable');
  expect(missing).toContain('Could not load the Verse runtime');
  expect(missing).toContain('make sure the demo server is running');
  expect(missing).not.toContain('Failed to fetch');
  await context.unroute('**/wasm/runtime.wasm');
  expect(await run(page)).toBe('Recovered');
});
