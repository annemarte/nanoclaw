#!/usr/bin/env node
/**
 * Strava token management for the OneCLI gateway.
 *
 *   node scripts/strava-auth.mjs setup     # one-time: exchange authorize code, create vault secret
 *   node scripts/strava-auth.mjs refresh   # renew access token, update vault secret (run from a timer)
 *
 * Strava access tokens expire after 6h, so the vault secret (injected as
 * `Authorization: Bearer <token>` for www.strava.com/api/*) is renewed here on
 * the host. Client id/secret + refresh token live in a mode-600 file outside the
 * repo; the container never sees them.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

const STATE = join(homedir(), '.config', 'nanoclaw', 'strava.json');
const SECRET_NAME = 'Strava';

function onecli(args) {
  return JSON.parse(execFileSync('onecli', args, { encoding: 'utf8' }));
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (hidden) rl._writeToOutput = () => {};
  process.stderr.write(question);
  return new Promise((resolve) =>
    rl.question('', (a) => {
      rl.close();
      if (hidden) process.stderr.write('\n');
      resolve(a.trim());
    }),
  );
}

function readDotenv() {
  const out = {};
  for (const p of [join(process.cwd(), '.env'), join(homedir(), 'nanoclaw-v2', '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(STRAVA_[A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] ??= m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return out;
}

async function tokenRequest(params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Strava token endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function saveState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(STATE, 0o600);
}

function findSecretId() {
  const list = onecli(['secrets', 'list']).data ?? [];
  return list.find((s) => s.name === SECRET_NAME)?.id;
}

function upsertSecret(accessToken) {
  const id = findSecretId();
  if (id) {
    onecli(['secrets', 'update', '--id', id, '--value', accessToken]);
    return 'updated';
  }
  onecli([
    'secrets', 'create',
    '--name', SECRET_NAME,
    '--type', 'generic',
    '--value', accessToken,
    '--host-pattern', 'www.strava.com',
    '--path-pattern', '/api/*',
    '--header-name', 'Authorization',
    '--value-format', 'Bearer {value}',
  ]);
  return 'created';
}

async function setup() {
  // Client id/secret come from env or the repo .env; only the one-time code is prompted.
  const dotenv = readDotenv();
  const clientId = process.env.STRAVA_CLIENT_ID || dotenv.STRAVA_CLIENT_ID || (await ask('Strava Client ID: '));
  const clientSecret =
    process.env.STRAVA_CLIENT_SECRET || dotenv.STRAVA_CLIENT_SECRET || (await ask('Strava Client Secret (hidden): ', { hidden: true }));
  const code = process.env.STRAVA_CODE || (await ask('Authorize code (hidden): ', { hidden: true }));
  const t = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const scope = (t.scope ?? '').toString();
  saveState({ clientId, clientSecret, refreshToken: t.refresh_token });
  console.log(`secret ${upsertSecret(t.access_token)}; athlete ${t.athlete?.id ?? '?'}; expires ${new Date(t.expires_at * 1000).toISOString()}`);
  if (!scope.includes('activity:read_all')) console.warn('warning: activity:read_all not granted — private activities will be hidden');
}

async function refresh() {
  if (!existsSync(STATE)) throw new Error(`${STATE} missing — run setup first`);
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const t = await tokenRequest({
    client_id: s.clientId,
    client_secret: s.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
  });
  // Strava may rotate the refresh token; always persist the latest one.
  if (t.refresh_token && t.refresh_token !== s.refreshToken) saveState({ ...s, refreshToken: t.refresh_token });
  console.log(`secret ${upsertSecret(t.access_token)}; expires ${new Date(t.expires_at * 1000).toISOString()}`);
}

// Alternative to `setup`: use a refresh token copied from the Strava API settings page.
async function importToken() {
  const dotenv = readDotenv();
  const clientId = process.env.STRAVA_CLIENT_ID || dotenv.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET || dotenv.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET missing from env or .env');
  const refreshToken =
    process.env.STRAVA_REFRESH_TOKEN ||
    dotenv.STRAVA_REFRESH_TOKEN ||
    dotenv.STRAVA_REFRESHTOKEN ||
    (await ask('Refresh token (hidden): ', { hidden: true }));
  saveState({ clientId, clientSecret, refreshToken });
  await refresh();
}

const cmd = process.argv[2];
const run = { setup, refresh, import: importToken }[cmd];
if (!run) {
  console.error('usage: strava-auth.mjs setup|import|refresh');
  process.exit(2);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
