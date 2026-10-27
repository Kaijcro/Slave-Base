/**
 * Sign in to Google once, so Slave Base can put your agents' work in your Google Drive.
 *
 *   npm run google-login
 *
 * Opens Google in your browser. Pick your account and allow access. Slave Base can only see the files it creates
 * (a "Slave Base" folder), nothing else in your Drive. The sign-in is saved in .google-token.json on this Mac only.
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { googleKeys, saveToken, SCOPE } from './google';
import { syncAll } from './sync';

const k = googleKeys();
if (!k) {
  console.error('✖ Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first (see README, "Google Drive").');
  process.exit(1);
}

const PORT = 3004;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth/google`;
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(12));

const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({
  client_id: k.id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT);
  if (url.pathname !== '/oauth/google') { res.writeHead(404).end(); return; }
  const done = (msg: string) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:18px system-ui;margin:40px">${msg}</p>`); };
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    done(`Something went wrong${url.searchParams.get('error') ? ` (${url.searchParams.get('error')})` : ''}. Close this tab and run <code>npm run google-login</code> again.`);
    setTimeout(() => process.exit(1), 300);
    return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: k.id, client_secret: k.secret, redirect_uri: REDIRECT, code: url.searchParams.get('code')!, code_verifier: verifier }),
    });
    const j = await r.json() as { access_token: string; refresh_token?: string; expires_in: number; error_description?: string };
    if (!r.ok) throw new Error(j.error_description ?? `status ${r.status}`);
    if (!j.refresh_token) throw new Error('Google didn’t send a long-term sign-in. Remove Slave Base at myaccount.google.com/permissions, then run this again.');
    saveToken({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 });
    done('✔ Connected to Google Drive. You can close this tab and go back to the Terminal.');
    console.log('✔ Signed in. Copying your agents’ work to Google Drive now...');
    const out = await syncAll({ log: console.log });
    console.log(`✔ Done. Your folder: ${out.folderUrl}`);
  } catch (e) {
    done('Couldn’t finish signing in. Check the Terminal for details.');
    console.error('✖', (e as Error).message);
  }
  setTimeout(() => process.exit(0), 300);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening Google in your browser. Choose your account and click Continue, then come back here.');
  console.log(`If it doesn't open, paste this link into your browser:\n${auth}\n`);
  exec(`open "${auth}"`);
});
