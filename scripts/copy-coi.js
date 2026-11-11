import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync(
  'node_modules/coi-serviceworker/coi-serviceworker.js',
  'public/coi-serviceworker.js',
);
