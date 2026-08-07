import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Points at the Cloudflare Worker (npm run dev -w worker) by default, since
    // that's what production uses. Set API_PROXY=http://localhost:8787 to
    // develop against the Express server in ../server instead.
    proxy: {
      '/api': process.env.API_PROXY || 'http://localhost:8788',
    },
  },
  build: {
    target: 'esnext',
    cssMinify: true,
    reportCompressedSize: false,
    // Vite inlines small assets as base64 data: URIs by default. Our CSP's
    // font-src is 'self' only (no data:), so any font weight small enough to
    // qualify was getting silently blocked by the browser instead of loading
    // — real requests, real font files, just never rendered. Every font
    // asset is now always emitted as its own file, which font-src 'self'
    // already allows, without loosening the CSP to admit data: URIs.
    assetsInlineLimit: 0,
  },
})
