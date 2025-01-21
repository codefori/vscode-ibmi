// sum.test.js
import { expect, test } from 'vitest'
import { getConnection } from './state'
import exp from 'constants';

test('adds 1 + 2 to equal 3', () => {
  const conn = getConnection();
  expect(conn).toBeDefined();
  expect(1+2).toBe(3);
})