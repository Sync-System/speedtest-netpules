import app from "./app.js";

// Entry point for Render/Railway/local dev — anything that runs this file
// directly as a long-lived process. Vercel never executes this file; it
// imports server/api/index.js instead, which re-exports the same app for
// its per-request serverless handler (see that file for why the split
// exists — the short version: Vercel only auto-detects functions under
// api/, and a plain file at the project root gets served as a static asset
// instead, which is why the browser was showing raw source code).
const PORT = process.env.PORT || 8787;

app.listen(PORT, () => {
  console.log(`Speed test server listening on http://localhost:${PORT}`);
});
