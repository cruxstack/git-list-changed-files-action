import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { runAction } from './helpers/action.ts';
import { createRepo } from './helpers/repo.ts';

const scratch = mkdtempSync(join(tmpdir(), 'e2e-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function eventFile(name: string, payload: unknown): string {
  const file = join(scratch, `${name}.json`);
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

const defaults = { 'github-token': 'e2e-token', 'diff-source': 'auto', 'output-format': 'json' };

describe('dist/main.js', () => {
  it('lists push changes from the local repository', async () => {
    const repo = createRepo();
    try {
      const before = repo.commit('init', { 'src/a.ts': 'a', 'README.md': 'r' });
      const after = repo.commit('change', { 'src/a.ts': 'b', 'src/b.ts': 'c', 'README.md': 's' });
      const result = await runAction(
        { ...defaults, paths: 'src/**', 'output-format': 'text', 'output-separator': ',' },
        [],
        {
          cwd: repo.dir,
          env: {
            GITHUB_WORKSPACE: repo.dir,
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_EVENT_NAME: 'push',
            GITHUB_EVENT_PATH: eventFile('push', { before, after }),
          },
        },
      );
      assert.equal(result.stderr, '');
      assert.equal(result.code, 0, result.stdout);
      result.api.done();
      assert.deepEqual(result.outputs, {
        'any-changed': 'true',
        'changed-files': 'src/a.ts,src/b.ts',
        'changed-count': '2',
        'any-added': 'true',
        'added-files': 'src/b.ts',
        'any-modified': 'true',
        'modified-files': 'src/a.ts',
        'any-deleted': 'false',
        'deleted-files': '',
        'any-renamed': 'false',
        'renamed-files': '',
        'diff-base': before,
        'diff-head': after,
        'diff-source': 'git',
      });
    } finally {
      repo.cleanup();
    }
  });

  it('falls back to the API for pull requests without local history', async () => {
    const base = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const result = await runAction(defaults, [
      {
        method: 'GET',
        path: '/repos/o/r/pulls/5',
        json: { head: { sha: head }, changed_files: 1 },
        check: (req) => assert.equal(req.headers.get('authorization'), 'Bearer e2e-token'),
      },
      { method: 'GET', path: '/repos/o/r/pulls/5/files', json: [{ filename: 'docs/new file.md', status: 'added' }] },
    ], {
      env: {
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile('pr', { pull_request: { number: 5, base: { sha: base }, head: { sha: head } } }),
      },
    });
    assert.equal(result.code, 0, result.stdout);
    result.api.done();
    assert.match(result.stdout, /^::add-mask::e2e-token$/m);
    assert.equal(result.outputs['changed-files'], '["docs/new file.md"]');
    assert.equal(result.outputs['diff-source'], 'api');
  });

  it('fails the step on invalid input', async () => {
    const result = await runAction({ ...defaults, 'diff-base': '--output=/tmp/x' }, []);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^::error::diff-base '--output=\/tmp\/x' starts with '-'$/m);
    assert.deepEqual(result.outputs, {});
  });
});
