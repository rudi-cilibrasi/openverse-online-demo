import { examples } from './examples.js';
import { formatDiagnostic } from './diagnostics.js';
const $ = id => document.getElementById(id);
const source = $('source'), args = $('args'), runButton = $('run');
let worker;
let running = false;
let messages = [];
let runSerial = 0;
let saved;
try { saved = JSON.parse(localStorage.getItem('openverse-playground')); } catch { /* Optional. */ }

function status(text, state = 'ready') {
  $('status').dataset.state = state;
  $('status').replaceChildren(Object.assign(document.createElement('span'), { className: 'status-dot' }), document.createTextNode(text));
}
function updateLines() {
  const count = source.value.split('\n').length;
  $('line-count').textContent = `${count} LINES`;
  $('line-numbers').textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  $('line-numbers').scrollTop = source.scrollTop;
}
// The saved record names the chosen example, and holds the source and
// arguments only when they differ from it, so an example nobody edited loads
// its current text after the examples change.
function save() {
  const name = $('example').value, example = examples[name];
  const edited = !example || source.value !== example.source || args.value !== example.args;
  const record = edited ? { source: source.value, args: args.value, example: name } : { example: name };
  try { localStorage.setItem('openverse-playground', JSON.stringify(record)); } catch { /* Storage is optional. */ }
}
// A link can carry a program: #code=…&args=…, percent-encoded UTF-8. The
// fragment never reaches the server. Once loaded it is removed from the address
// bar, so that a reload keeps later edits (they are saved like any others).
function loadFromLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('code');
  if (code === null) return;
  source.value = code;
  args.value = params.get('args') ?? '';
  $('arguments').open = Boolean(args.value);
  history.replaceState(null, '', location.pathname + location.search);
  updateLines(); save();
}
function linkToProgram() {
  const params = new URLSearchParams({ code: source.value });
  if (args.value) params.set('args', args.value);
  return `${location.origin}${location.pathname}#${params}`;
}
async function copyLink() {
  const link = linkToProgram(), button = $('share');
  try {
    await navigator.clipboard.writeText(link);
    button.textContent = 'Link copied';
  } catch {
    history.replaceState(null, '', link); // no clipboard: leave it in the address bar
    button.textContent = 'Link in address bar';
  }
  setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
}
function loadExample() {
  const example = examples[$('example').value];
  source.value = example.source;
  args.value = example.args;
  $('arguments').open = $('example').value === 'args';
  updateLines(); save();
}
const chosen = saved && examples[saved.example] ? saved.example : 'hello';
$('example').value = chosen;
source.value = examples[chosen].source;
args.value = examples[chosen].args;
if (saved && typeof saved.source === 'string' && typeof saved.args === 'string') {
  source.value = saved.source; args.value = saved.args;
}
$('arguments').open = Boolean(args.value);
updateLines();
loadFromLink();
window.addEventListener('hashchange', loadFromLink);
source.addEventListener('input', () => { updateLines(); save(); });
source.addEventListener('scroll', () => { $('line-numbers').scrollTop = source.scrollTop; });
args.addEventListener('input', save);
$('example').addEventListener('change', loadExample);
$('reset').addEventListener('click', loadExample);
$('share').addEventListener('click', copyLink);
$('clear').addEventListener('click', () => { messages = []; $('output').textContent = ''; $('output').hidden = true; $('empty-output').hidden = false; });
source.addEventListener('keydown', event => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    source.setRangeText('    ', source.selectionStart, source.selectionEnd, 'end');
    updateLines(); save();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); }
});
runButton.addEventListener('click', run);

function display(text, error = false) {
  messages.push(text);
  $('empty-output').hidden = true;
  $('output').hidden = false;
  $('output').classList.toggle('error', error || $('output').classList.contains('error'));
  $('output').textContent = messages.join('\n');
  $('output').scrollTop = $('output').scrollHeight;
}
function run() {
  if (running || !worker) return;
  running = true;
  const serial = ++runSerial;
  const submittedSource = source.value;
  runButton.disabled = true;
  runButton.setAttribute('aria-busy', 'true');
  messages = []; $('output').textContent = ''; $('output').classList.remove('error');
  $('empty-output').hidden = true; $('output').hidden = false; $('timing').textContent = '';
  status('Starting…', 'running');
  const channel = new MessageChannel();
  // Service workers have browser-controlled lifetimes. Surface disappearance or
  // a pathological compiler input without leaving the page permanently busy.
  const timer = setTimeout(() => {
    if (serial !== runSerial) return;
    finish(); channel.port1.close();
    display('No response after 60 seconds. The browser may still be finishing this program. Try reloading the page.', true);
    status('No response', 'error');
  }, 60000);
  function finish() {
    clearTimeout(timer); running = false; runButton.disabled = false; runButton.removeAttribute('aria-busy');
  }
  channel.port1.onmessage = ({ data }) => {
    if (serial !== runSerial) return;
    if (data.type === 'phase') status(data.phase, 'running');
    if (data.type === 'diagnostic') display(formatDiagnostic(submittedSource, data.text), true);
    if (data.type === 'stdout' || data.type === 'stderr') display(data.text, data.type === 'stderr');
    if (data.type === 'done') {
      finish(); channel.port1.close();
      const labels = { 0: 'Finished', 1: 'Program failed', 2: 'Runtime error', 3: 'Step or resource limit', 4: 'Check your source' };
      status(data.errorKind === 'loading' ? 'Runner unavailable' : labels[data.code] || `Exit ${data.code}`, data.code === 0 ? 'ready' : 'error');
      $('timing').textContent = `${Math.round(data.duration)} ms`;
      if (!messages.length) display('(Program finished without printing.)');
    }
  };
  try { worker.postMessage({ type: 'run', source: submittedSource, args: args.value, fuel: Number($('fuel').value) }, [channel.port2]); }
  catch (error) { finish(); display(error.message, true); status('Could not start', 'error'); }
}

async function initialize() {
  try {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) throw new Error('Open this page on localhost or HTTPS to run Verse.');
    await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    const registration = await navigator.serviceWorker.ready;
    worker = registration.active;
    if (!worker) throw new Error('The background runner could not start. Reload the page.');
    status('Ready when you are'); runButton.disabled = false;
  } catch (error) { status('Runner unavailable', 'error'); display(error.message, true); }
}
initialize();
