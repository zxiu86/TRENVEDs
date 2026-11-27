import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          const esbuildWasm = path.resolve(__dirname, 'node_modules/esbuild-wasm/esbuild.wasm');
          if (fs.existsSync(distDir) && fs.existsSync(esbuildWasm)) {
            fs.copyFileSync(esbuildWasm, path.resolve(distDir, 'esbuild.wasm'));
          }
        },
      },
      {
        name: 'serve-esbuild-wasm-dev',
        apply: 'serve',
        configureServer(server): void {
          server.middlewares.use((req, res, next) => {
            const urlPath = (req.url ?? '').split('?')[0];
            if (urlPath === '/esbuild.wasm' || urlPath.endsWith('/esbuild.wasm')) {
              const wasmPath = path.resolve(__dirname, 'node_modules/esbuild-wasm/esbuild.wasm');
              if (fs.existsSync(wasmPath)) {
                res.setHeader('Content-Type', 'application/wasm');
                fs.createReadStream(wasmPath).pipe(res);
                return;
              }
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
