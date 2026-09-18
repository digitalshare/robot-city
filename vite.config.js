import { defineConfig } from 'vite';
import { aiProxyPlugin } from './scripts/ai-proxy-plugin.js';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [aiProxyPlugin()],
});
