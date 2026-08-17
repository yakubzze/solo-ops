import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite jest uzywany w dwoch trybach:
//  - dev: server/index.mjs tworzy go w middlewareMode (jeden port, jeden proces)
//  - build: `npm run build` produkuje dist/, ktore serwuje ten sam serwer
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
