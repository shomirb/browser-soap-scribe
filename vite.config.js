import { defineConfig } from 'vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: isolation, port: 5173 },
  preview: { headers: isolation, port: 4173 },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'],
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
  },
});
