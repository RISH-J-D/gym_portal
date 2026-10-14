import { build } from 'vite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporaryOutput = await mkdtemp(join(tmpdir(), 'heaven-hell-firebase-'));
try {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      lib: {
        entry: 'src/firebase-compat-entry.js',
        name: 'FirebaseCompat',
        formats: ['iife'],
        fileName: () => 'firebase-compat.js',
      },
      outDir: temporaryOutput,
      emptyOutDir: true,
      minify: true,
    },
  });
  await copyFile(join(temporaryOutput, 'firebase-compat.js'), resolve('public/firebase-compat.js'));
} finally {
  await rm(temporaryOutput, { recursive: true, force: true });
}
