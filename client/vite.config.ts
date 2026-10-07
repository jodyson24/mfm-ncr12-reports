import { defineConfig } from 'vite';
export default defineConfig({ server: { host: '0.0.0.0', port: 4885, strictPort: true, proxy: { '/api': { target: 'http://localhost:4880', changeOrigin: true } } }, preview: { host: '0.0.0.0', port: 4885, strictPort: true }, build: { outDir: 'dist', emptyOutDir: true } });
