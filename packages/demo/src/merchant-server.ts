/**
 * Merchant menu server. Each GET returns a freshly signed menu (new nonce, 5-minute window),
 * the same thing a till would put in a rotating QR code.
 *   GET /menu/cafe   GET /menu/shady   GET /health
 */
import { createServer } from 'node:http';
import { menuToJson } from '@tally-near/sdk';
import { cafeLines, freshMenu, shadyLines } from './catalogs.ts';
import { demoKeys, ids, log } from './env.ts';

const keys = demoKeys();
const port = Number(process.env.PORT ?? 8787);

createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health') return res.end('{"ok":true}');
  const which = path === '/menu/cafe' ? [ids.merchant, keys.cafeMenu, cafeLines] as const
    : path === '/menu/shady' ? [ids.shady, keys.shadyMenu, shadyLines] as const : null;
  if (!which) {
    res.statusCode = 404;
    return res.end('{"error":"try /menu/cafe or /menu/shady"}');
  }
  const m = freshMenu(ids.contract, which[0], which[1], which[2]);
  log('menu', `${which[0]} nonce ${m.nonce} root ${m.root.slice(0, 12)}…`);
  res.end(menuToJson(m));
}).listen(port, () => log('merchant', `menus at http://localhost:${port}/menu/cafe and /menu/shady`));
