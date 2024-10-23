// example.test.js
import { server } from './setupTests';
import { describe, it, expect } from 'vitest';

describe('Database Tests', () => {
  it('should fetch data from the database', async () => {
    const result = server.currentHost;
    expect(result).toBeDefined();
  });
});