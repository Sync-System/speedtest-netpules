// Vercel's zero-config detection only treats files under api/ as serverless
// functions — a file at the project root (where server/index.js lives, for
// Render/Railway/local dev) is just served as a static asset instead, which
// is why the raw source was showing up in the browser. This file exists
// purely so the same app ends up in the one place Vercel actually looks;
// there's no separate logic here, it's the identical Express app from
// app.js, just re-exported from the location Vercel expects.
export { default } from "../app.js";
