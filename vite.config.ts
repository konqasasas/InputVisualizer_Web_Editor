import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages usually serves project sites from a sub-path like
// https://<user>.github.io/<repo>/.
// A relative base keeps built JS/CSS paths working both there and on a custom/root domain.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 }
});
