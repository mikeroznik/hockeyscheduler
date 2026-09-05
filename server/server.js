import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp, warmup } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;

const app = createApp();
app.use(express.static(join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Hockey schedule server on http://localhost:${PORT}`);
  warmup();
});
