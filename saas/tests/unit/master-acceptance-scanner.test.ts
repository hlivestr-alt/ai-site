import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../master-acceptance/secret-audit.mjs';

test('acceptance secret scanner distinguishes common-word collisions from credential contexts', () => {
  const secrets = [{ category: 'DATABASE_PASSWORD fixture', value: 'root' }];
  assert.deepEqual(scanText('The root node and root workspace are documented here.', secrets), []);
  assert.deepEqual(scanText('postgresql://fixture:root@127.0.0.1/fixture', secrets), ['DATABASE_PASSWORD fixture']);
  assert.deepEqual(scanText('POSTGRES_PASSWORD=root\n', secrets), ['DATABASE_PASSWORD fixture']);
});

test('acceptance secret scanner reports categories without returning matched values', () => {
  const value = 'synthetic-only-high-entropy-credential-1a2b3c';
  const result = scanText(`body ${value}`, [{ category: 'WAVESPEED_API_KEY', value }]);
  assert.deepEqual(result, ['WAVESPEED_API_KEY']);
  assert.equal(JSON.stringify(result).includes(value), false);
});
