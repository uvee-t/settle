import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 3187;

test('static frontend serves the app shell, stylesheet, and JavaScript', async (t) => {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, FRONTEND_PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => server.kill('SIGTERM'));
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { response = await fetch(`http://127.0.0.1:${port}/`); break; }
    catch { await delay(100); }
  }
  assert.ok(response, 'frontend server should start');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Settle — Contract to cash/);
  const config = await fetch(`http://127.0.0.1:${port}/config.js`);
  assert.equal(config.status, 200);
  assert.match(await config.text(), /window\.SETTLE_API_URL/);
  const css = await fetch(`http://127.0.0.1:${port}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /\.app-shell/);
  const js = await fetch(`http://127.0.0.1:${port}/app.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /function renderOverview/);
});
