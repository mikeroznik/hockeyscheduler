// Vercel serverless entrypoint. Static files in /public are served by Vercel's
// CDN directly; this function handles /api/* only (see vercel.json rewrites).
import { createApp, warmup } from '../server/app.js';

const app = createApp();
warmup();

export default app;
