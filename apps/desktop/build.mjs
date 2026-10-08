import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'src'), out, { recursive: true });
// The shared companion core (view model, reminders, Pip, panel) ships as plain modules next to the panel.
await cp(resolve(root, '../../packages/companion/src'), resolve(out, 'companion'), { recursive: true, filter: (f) => !f.endsWith('.d.ts') });
await cp(resolve(root, 'NOTICE.md'), resolve(out, 'staff-notice.md'));
