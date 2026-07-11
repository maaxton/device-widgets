import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Self-alias so a bare `device-widgets/...` specifier (the same form the
// monorepo's extension-alias convention used when this test lived at
// backend/test/unit/device-widgets.provider.test.js) resolves to this repo's
// own root, now that device-widgets is a standalone package.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
  resolve: {
    alias: [{ find: /^device-widgets\//, replacement: `${root}/` }],
  },
});
