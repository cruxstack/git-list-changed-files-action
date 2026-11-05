import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromApiFile, parseNameStatus } from '../src/changes.ts';

describe('parseNameStatus', () => {
  it('maps every git status', () => {
    const out = ['A', 'new.txt', 'M', 'mod.txt', 'D', 'gone.txt', 'R087', 'old name.txt', 'new name.txt', 'C100', 'src.txt', 'copy.txt', 'T', 'link', 'U', 'conflict', ''].join('\0');
    assert.deepEqual(parseNameStatus(out), [
      { status: 'added', path: 'new.txt' },
      { status: 'modified', path: 'mod.txt' },
      { status: 'deleted', path: 'gone.txt' },
      { status: 'renamed', path: 'new name.txt', previousPath: 'old name.txt' },
      { status: 'added', path: 'copy.txt' },
      { status: 'modified', path: 'link' },
      { status: 'modified', path: 'conflict' },
    ]);
  });

  it('handles empty and truncated output', () => {
    assert.deepEqual(parseNameStatus(Buffer.alloc(0)), []);
    assert.throws(() => parseNameStatus('M\0'), /truncated/);
    assert.throws(() => parseNameStatus('R100\0a\0'), /truncated/);
  });
});

describe('fromApiFile', () => {
  it('maps API statuses', () => {
    assert.deepEqual(fromApiFile({ filename: 'a', status: 'added' }), { status: 'added', path: 'a' });
    assert.deepEqual(fromApiFile({ filename: 'a', status: 'copied' }), { status: 'added', path: 'a' });
    assert.deepEqual(fromApiFile({ filename: 'a', status: 'removed' }), { status: 'deleted', path: 'a' });
    assert.deepEqual(fromApiFile({ filename: 'b', status: 'renamed', previous_filename: 'a' }), { status: 'renamed', path: 'b', previousPath: 'a' });
    assert.deepEqual(fromApiFile({ filename: 'b', status: 'renamed' }), { status: 'added', path: 'b' });
    assert.deepEqual(fromApiFile({ filename: 'a', status: 'changed' }), { status: 'modified', path: 'a' });
    assert.deepEqual(fromApiFile({ filename: 'a', status: 'modified' }), { status: 'modified', path: 'a' });
    assert.equal(fromApiFile({ filename: 'a', status: 'unchanged' }), undefined);
  });
});
