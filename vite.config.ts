import { defineConfig } from 'vite';

// GitHub Pages serves the site from a repo subpath. Without this base,
// every asset 404s and you spend forty minutes on it. (Spec §16.)
export default defineConfig({
  base: '/beyond-boring-death-march/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  // Dev-only: the social Function App's CORS allowlist covers the Pages
  // origin (and localhost:5173) — not arbitrary dev ports. systems/social.ts
  // uses `/api` in dev so requests ride this proxy instead. Production
  // builds call the Function App directly (its origin is allowlisted).
  server: {
    proxy: {
      '/api': {
        target: 'https://death-march-prod-functions.azurewebsites.net',
        changeOrigin: true,
      },
    },
  },
});
