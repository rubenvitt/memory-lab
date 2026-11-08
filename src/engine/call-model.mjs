// The one place that talks to a model. To use another provider, replace this function.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class RateLimitError extends Error {}
export class ModelError extends Error {}

const RATE_LIMIT = /rate.?limit|usage.?limit|too many requests|\b429\b|quota/i;
const CLEAN_ITEMS = new Set(['agent_message', 'reasoning']);

export function parseEvents(stdout) {
  return stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}

export function interpret({ code, stdout, stderr, timedOut }) {
  const events = parseEvents(stdout);
  const failures = events.filter((e) => e.type === 'error' || e.type === 'turn.failed').map((e) => JSON.stringify(e));
  const messages = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message');
  if (timedOut) throw new ModelError('timeout');
  // `error` events can be mere reconnect notices (codex then falls back to HTTPS), only turn.failed is final.
  if (code !== 0 || events.some((e) => e.type === 'turn.failed') || !messages.length) {
    const detail = [...failures, stderr].join('\n').slice(0, 2000);
    if (RATE_LIMIT.test(detail)) throw new RateLimitError(detail);
    throw new ModelError(`codex exit ${code}: ${detail}`);
  }
  const text = messages.at(-1).item.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelError(`no valid JSON in answer: ${text.slice(0, 500)}`);
  }
  return {
    text,
    parsed,
    usage: events.find((e) => e.type === 'turn.completed')?.usage ?? null,
    // A judge must not look at anything but its prompt, so tool use marks the record.
    tainted: events.some((e) => e.type === 'item.completed' && !CLEAN_ITEMS.has(e.item?.type)),
    events,
  };
}

export async function callModel({ model, prompt, schema, effort = 'low', timeoutMs = 120_000 }) {
  const dir = await mkdtemp(join(tmpdir(), 'ml-'));
  try {
    const schemaFile = join(dir, 'schema.json');
    await writeFile(schemaFile, JSON.stringify(schema));
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-m', model, '-c', `model_reasoning_effort="${effort}"`,
      // No tool may reach outside the prompt: web search, the apps MCP server (it also searches the web), browser, shell.
      '-c', 'web_search="disabled"', '--disable', 'apps', '--disable', 'browser_use', '--disable', 'in_app_browser', '--disable', 'shell_tool',
      '--json', '--output-schema', schemaFile, '-'];
    const child = spawn('codex', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.on('error', () => {}); // a dying child must surface as exit code, not EPIPE
    child.stdin.end(prompt);
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    clearTimeout(timer);
    return interpret({ code, stdout, stderr, timedOut });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
