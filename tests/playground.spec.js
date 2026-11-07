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
