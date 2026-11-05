import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRange, revProblem } from '../src/event.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const none = { base: '', head: '' };

describe('resolveRange', () => {
  it('uses the pull request base and head with the merge base', () => {
    const event = { pull_request: { number: 7, base: { sha: A }, head: { sha: B } } };
    for (const name of ['pull_request', 'pull_request_target', 'pull_request_review']) {
      assert.deepEqual(resolveRange(name, event, none), { base: A, head: B, mergeBase: true, pull: 7 });
    }
  });

  it('uses the merge group range', () => {
    assert.deepEqual(resolveRange('merge_group', { merge_group: { base_sha: A, head_sha: B } }, none), { base: A, head: B, mergeBase: true });
  });

  it('diffs pushes directly', () => {
    assert.deepEqual(resolveRange('push', { before: A, after: B }, none), { base: A, head: B, mergeBase: false });
  });

  it('compares new branches with the default branch', () => {
    const event = { before: ZERO, after: B, created: true, repository: { default_branch: 'main' } };
    assert.deepEqual(resolveRange('push', event, none), { base: 'main', head: B, mergeBase: true });
    assert.throws(() => resolveRange('push', { before: ZERO, after: B }, none), /default_branch/);
  });

  it('reports branch deletions unless both ends are given', () => {
    assert.equal(resolveRange('push', { before: A, after: ZERO, deleted: true }, none), 'deleted');
    assert.equal(resolveRange('push', { before: A, after: ZERO }, none), 'deleted');
    assert.deepEqual(resolveRange('push', { before: A, after: ZERO }, { base: 'main', head: 'dev' }), { base: 'main', head: 'dev', mergeBase: true });
  });

  it('lets inputs override either end and drops the pull request shortcut', () => {
    const event = { pull_request: { number: 7, base: { sha: A }, head: { sha: B } } };
    assert.deepEqual(resolveRange('pull_request', event, { base: 'main', head: '' }), { base: 'main', head: B, mergeBase: true });
    assert.deepEqual(resolveRange('push', { before: A, after: B }, { base: '', head: 'HEAD' }), { base: A, head: 'HEAD', mergeBase: false });
  });

  it('requires explicit ranges for other events', () => {
    assert.throws(() => resolveRange('workflow_dispatch', {}, none), /required for 'workflow_dispatch' events/);
    assert.throws(() => resolveRange('', {}, { base: 'main', head: '' }), /required for 'unknown' events/);
    assert.throws(() => resolveRange('pull_request', {}, none), /required/);
    assert.throws(() => resolveRange('merge_group', {}, none), /required/);
    assert.deepEqual(resolveRange('schedule', {}, { base: 'main', head: 'HEAD' }), { base: 'main', head: 'HEAD', mergeBase: true });
  });

  it('validates payload SHAs', () => {
    assert.throws(() => resolveRange('push', { before: '--output=x', after: B }, none), /'before' is not a commit SHA/);
    assert.throws(() => resolveRange('pull_request', { pull_request: { base: { sha: A }, head: {} } }, none), /pull_request.head.sha/);
  });

  it('ignores invalid pull request numbers', () => {
    const event = { pull_request: { number: -1, base: { sha: A }, head: { sha: B } } };
    assert.deepEqual(resolveRange('pull_request', event, none), { base: A, head: B, mergeBase: true });
  });
});

describe('revProblem', () => {
  it('accepts SHAs, refs and ancestry suffixes', () => {
    for (const rev of [A, 'abc1234', 'main', 'origin/main', 'HEAD~1', 'HEAD^', 'v1.0.0^2~3']) assert.equal(revProblem(rev), undefined, rev);
  });

  it('rejects options and invalid names', () => {
    for (const rev of ['-x', '--output=/tmp/x', 'a..b', 'a b', '~1', '']) assert.notEqual(revProblem(rev), undefined, rev);
  });
});
