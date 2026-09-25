// Local dev, without the Vercel CLI.
//
// Serves the static site from the repo root and routes /api/* to the same
// handler modules Vercel will run, through a req/res shim thin enough to be
// obviously equivalent. Reads .env itself so the Last.fm key is present.
//
//   node tools/serve.mjs          then open http://localhost:4321
//
// This is a development convenience, not part of the deployed site.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 4321;

// Same parsing Vercel does for you: KEY=value, blank lines and # ignored.
// .env holds the Last.fm key; .env.local is written by `vercel blob create-store`
// and carries the Blob token. First file to set a name wins, so .env still
// takes precedence over anything the CLI pulled down.
for (const name of ['.env', '.env.local']) {
	if (!existsSync(join(ROOT, name))) continue;
	for (const line of readFileSync(join(ROOT, name), 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.mp4': 'video/mp4',
	'.ico': 'image/x-icon',
};

const handlers = {
	'/api/lately': () => import('../api/lately.js'),
	'/api/resolve': () => import('../api/resolve.js'),
	'/api/queue': () => import('../api/queue.js'),
	'/api/search': () => import('../api/search.js'),
};

createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);

	const route = handlers[url.pathname];
	if (route) {
		// The shape Vercel's Node runtime hands a function: req.query already
		// parsed, res.status().json() chainable.
		const shim = {
			status(code) { res.statusCode = code; return shim; },
			setHeader(k, v) { res.setHeader(k, v); return shim; },
			json(body) {
				res.setHeader('content-type', 'application/json; charset=utf-8');
				res.end(JSON.stringify(body));
				return shim;
			},
		};
		try {
			const mod = await route();
			// Vercel parses a JSON body and hands it over as req.body. This shim
			// passed none at all, which meant a POST endpoint could not be
			// developed locally -- the handler saw an empty request and every
			// submission looked malformed.
			let body;
			if (req.method === 'POST' || req.method === 'PUT') {
				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				const raw = Buffer.concat(chunks).toString('utf8');
				if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
			}
			await mod.default({
				query: Object.fromEntries(url.searchParams),
				method: req.method,
				headers: req.headers,
				socket: req.socket,
				body,
			}, shim);
		} catch (err) {
			res.statusCode = 500;
			res.end(JSON.stringify({ error: String(err) }));
		}
		return;
	}

	// Static. normalize() then a prefix check keeps ../ out of the path.
	let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
	if (!path.startsWith(ROOT)) { res.statusCode = 403; return res.end('no'); }
	if (url.pathname.endsWith('/')) path = join(path, 'index.html');

	try {
		const body = await readFile(path);
		res.setHeader('content-type', TYPES[extname(path)] ?? 'application/octet-stream');
		res.end(body);
	} catch {
		res.statusCode = 404;
		res.end('not found');
	}
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
