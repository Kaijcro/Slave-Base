/**
 * Sign in to Etsy once, so your agents can publish to your shop.
 *
 *   npm run etsy-login
 *
 * Opens Etsy in your browser, you click "Grant access", and the token is saved in .etsy-token.json
 * on this Mac only. Run it again if the agents ever say your Etsy sign-in expired (about every 90 days).
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { keys, saveToken, REDIRECT_URI, SCOPES, etsy } from './etsy';

const { key } = keys();
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(12));

const auth = new URL('https://www.etsy.com/oauth/connect');
auth.search = new URLSearchParams({
  response_type: 'code', client_id: key, redirect_uri: REDIRECT_URI, scope: SCOPES.join(' '),
  state, code_challenge: challenge, code_challenge_method: 'S256',
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT_URI);
  if (url.pathname !== '/oauth/redirect') { res.writeHead(404).end(); return; }
  const done = (msg: string) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:18px system-ui;margin:40px">${msg}</p>`); };
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    done('Something went wrong. Close this tab and run <code>npm run etsy-login</code> again.');
    return;
  }
  try {
    const r = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: key, redirect_uri: REDIRECT_URI, code: url.searchParams.get('code')!, code_verifier: verifier }),
    });
    const j = await r.json() as { access_token: string; refresh_token: string; expires_in: number; error_description?: string };
    if (!r.ok) throw new Error(j.error_description ?? `status ${r.status}`);
    // The user id is the number before the dot in the access token.
    saveToken({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, user_id: Number(j.access_token.split('.')[0]) });
    const me = await etsy<{ shop_id?: number }>('GET', '/users/me', { auth: true });
    done(me.shop_id ? '✔ Connected to your Etsy shop. You can close this tab.' : '✔ Signed in, but this Etsy account has no shop yet. Open one at etsy.com/sell, then run this again.');
    console.log(me.shop_id ? `✔ Connected. Shop id ${me.shop_id}. Your agents can publish now.` : '✔ Signed in, but no shop on this account yet.');
  } catch (e) {
    done('Couldn’t finish signing in. Check the Terminal for details.');
    console.error('✖', (e as Error).message);
  }
  setTimeout(() => process.exit(0), 300);
});

server.listen(3003, () => {
  console.log('Opening Etsy in your browser. Click "Grant access", then come back here.');
  console.log(`If it doesn't open, paste this link into your browser:\n${auth}\n`);
  exec(`open "${auth}"`);
});
