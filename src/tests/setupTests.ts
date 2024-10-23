// setupTests.js
import { beforeAll, afterAll } from 'vitest';

import IBMi from '../api/IBMi';

let server: IBMi;

beforeAll(async () => {
  server = new IBMi();

  await server.connect({
    host: `iopen.iinthecloud.com`,
    port: 22,
    username: `SNDBX3`,
    password: `SNDBX3`,
    name: `system`
  });
});

afterAll(async () => {
  server.end();
});

export { server };