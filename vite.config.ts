import { defineConfig } from 'vite';

// GitHub Pages serves the site from a repo subpath. Without this base,
// every asset 404s and you spend forty minutes on it. (Spec §16.)
export default defineConfig({
  base: '/beyond-boring-death-march/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
