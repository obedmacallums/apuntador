// Vite is used only as a development server: the page reloads on every save, and `npm run dev:lan`
// opens it to phones and tablets on the same network over HTTPS. GitHub Pages still publishes the
// repository exactly as it is, with no build step.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const root = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const asOnPages = {
  name: 'apuntador-as-on-pages',
  configureServer(server) {
    // Serve js/ and css/ (subfolders included) byte for byte, as GitHub Pages does. Vite would otherwise
    // rewrite them: in js/transcribe/worker.js it turns `import(runtime.lib)` into a helper plus a static
    // import of its own client, which the worker cannot load.
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url || '').split('?')[0]);
      if (!/^\/(js|css)\/(?:[\w-]+\/)*[\w.-]+\.(js|css)$/.test(path)) return next();
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', TYPES[extname(file)]);
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(file).pipe(res);
    });
    // Those files never enter Vite's module graph, so reload the whole page whenever one changes.
    server.watcher.on('change', file => {
      if (/\.(html|js|css|svg)$/.test(file) && !file.includes(sep + 'node_modules' + sep)) server.hot.send({ type: 'full-reload' });
    });
  }
};

export default defineConfig(({ mode }) => ({
  plugins: [asOnPages, ...(mode === 'lan' ? [basicSsl()] : [])],
  // 'lan': listen on the local network with a self-signed certificate. WebGPU and the model cache
  // need a secure context, which plain http://192.168.x.x is not.
  server: { host: mode === 'lan', port: 5173 }
}));
