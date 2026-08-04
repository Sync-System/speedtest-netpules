# speedtest-netpules

**NetPulse** — a free, self-hosted internet speed test. Measures download, upload, ping, jitter, and latency under load (bufferbloat), run entirely against this project's own server, no third-party test infrastructure required.

## Structure

- `server/` — Express backend: streams the download/upload test payloads, resolves IP/ISP/location, ping endpoint
- `web/` — React + Vite + TypeScript frontend: the speed test UI

## Development

```bash
npm install
npm run dev
```

Starts the backend on `:8787` and the frontend on `:5173` together.

## Production

```bash
npm run build
npm start
```

Builds the frontend and serves it from the same Express server as the API, single origin.
