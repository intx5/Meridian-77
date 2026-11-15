import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createMlMiddleware } from './src/server/mlHandler.ts'

function mlApiPlugin(): Plugin {
  // Server-side middleware for /api/ml/plan and /api/ml/status
  const middleware = createMlMiddleware()
  return {
    name: 'meridian77-ml-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mlApiPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'], passWithNoTests: true },
})
