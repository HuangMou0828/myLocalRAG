import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath, URL } from 'node:url'

const enableAnalyze = process.env.ANALYZE === '1'

export default defineConfig({
  plugins: [
    vue(),
    enableAnalyze && visualizer({
      filename: 'dist/bundle-stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
    enableAnalyze && visualizer({
      filename: 'dist/bundle-stats.json',
      template: 'raw-data',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](?:vue|@vue)[\\/]/.test(id)) return 'vendor-vue'
          if (/[\\/]node_modules[\\/]tailwind-merge[\\/]/.test(id)) return 'vendor-tailwind-merge'
          if (/[\\/]node_modules[\\/]lucide-vue-next[\\/]/.test(id)) return 'vendor-lucide'
          if (/[\\/]node_modules[\\/]reka-ui[\\/]/.test(id)) return 'vendor-reka-ui'
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
})
