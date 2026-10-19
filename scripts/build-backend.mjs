import { build } from 'vite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporaryOutput = await mkdtemp(join(tmpdir(), 'heaven-hell-backend-'));
try {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      lib: {
        entry: 'src/supabase-compat-entry.js',
        name: 'HHBackend',
        formats: ['iife'],
        fileName: () => 'supabase-compat.js',
      },
      outDir: temporaryOutput,
      emptyOutDir: true,
      minify: true,
    },
  });
  await copyFile(join(temporaryOutput, 'supabase-compat.js'), resolve('public/supabase-compat.js'));
} finally {
  await rm(temporaryOutput, { recursive: true, force: true });
}
