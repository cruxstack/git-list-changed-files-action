import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Log } from '../src/lib/actions.ts';
import { Git } from '../src/lib/git.ts';
import { GitHub } from '../src/lib/github.ts';
import type { Config } from '../src/config.ts';
import { PathFilter } from '../src/filter.ts';
import { run } from '../src/run.ts';
import { fakeFetch, type Route } from './helpers/fake-fetch.ts';
import { createRepo, type TestRepo } from './helpers/repo.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

const config = (overrides: Partial<Config> & { paths?: string[]; ignore?: string[] } = {}): Config => {
  const { paths = [], ignore = [], ...rest } = overrides;
  return {
    token: 'tok',
    repository: { owner: 'o', repo: 'r' },
    cwd: '.',
    filter: new PathFilter(paths, ignore),
    base: '',
    head: '',
    source: 'auto',
    format: 'json',
    separator: '\n',
    eventName: 'push',
    event: {},
    ...rest,
  };
};

async function execute(cwd: string, cfg: Config, routes: Route[] = []) {
  const fake = fakeFetch(routes);
  const logs: string[] = [];
  const log: Log = { debug() {}, info: (m) => logs.push(m), warning: (m) => logs.push(m), error() {} };
  const github = () => new GitHub({ token: cfg.token, userAgent: 'test', apiUrl: 'https://api.github.com', fetch: fake.fetch, sleep: async () => {} });
  const outputs = await run(cfg, { git: new Git(cwd), github, log });
  fake.done();
  return { outputs, logs };
}

const lists = (outputs: Record<string, unknown>) =>
  Object.fromEntries(['changed', 'added', 'modified', 'deleted', 'renamed'].map((k) => [k, JSON.parse(String(outputs[`${k}-files`]))]));

describe('run with git', () => {
  let repo: TestRepo;
  beforeEach(() => (repo = createRepo()));
  afterEach(() => repo.cleanup());

  it('lists push changes by status', async () => {
    const before = repo.commit('init', { 'keep.txt': 'k', 'mod.txt': 'one', 'gone.txt': 'g', 'docs/old.md': 'a long enough file body to keep rename detection stable\n' });
    repo.git('rm', '-q', 'gone.txt');
    mkdirSync(join(repo.dir, 'src'));
    repo.git('mv', 'docs/old.md', 'src/new.md');
    const after = repo.commit('change', { 'mod.txt': 'two', 'sp ace/ünï.txt': 'u' });
    const { outputs } = await execute(repo.dir, config({ event: { before, after } }));
    assert.deepEqual(lists(outputs), {
      changed: ['gone.txt', 'mod.txt', 'sp ace/ünï.txt', 'src/new.md'],
      added: ['sp ace/ünï.txt'],
      modified: ['mod.txt'],
      deleted: ['gone.txt'],
      renamed: ['src/new.md'],
    });
    assert.deepEqual(Object.fromEntries(Object.entries(outputs).filter(([key]) => !key.endsWith('-files'))), {
      'any-changed': true,
      'any-added': true,
      'any-modified': true,
      'any-deleted': true,
      'any-renamed': true,
      'changed-count': 4,
      'diff-base': before,
      'diff-head': after,
      'diff-source': 'git',
    });
  });

  it('matches renames by either path and formats text output', async () => {
    const before = repo.commit('init', { 'docs/a.md': 'a long enough file body to keep rename detection stable\n', 'x.txt': 'x' });
    mkdirSync(join(repo.dir, 'src'));
    repo.git('mv', 'docs/a.md', 'src/a.md');
    const after = repo.commit('move', { 'x.txt': 'y' });
    const { outputs } = await execute(repo.dir, config({ event: { before, after }, paths: ['docs/**'], format: 'text', separator: ' ' }));
    assert.equal(outputs['changed-files'], 'src/a.md');
    assert.equal(outputs['renamed-files'], 'src/a.md');
    assert.equal(outputs['modified-files'], '');
    assert.equal(outputs['any-modified'], false);
    assert.equal(outputs['changed-count'], 1);
  });

  it('diffs pull requests from the merge base', async () => {
    repo.commit('init', { 'a.txt': 'a' });
    repo.git('checkout', '-q', '-b', 'feature');
    const head = repo.commit('feature', { 'feature.txt': 'f' });
    repo.git('checkout', '-q', 'main');
    const base = repo.commit('main moved', { 'main-only.txt': 'm' });
    const event = { pull_request: { number: 3, base: { sha: base }, head: { sha: head } } };
    const { outputs } = await execute(repo.dir, config({ eventName: 'pull_request', event }));
    assert.deepEqual(lists(outputs)['changed'], ['feature.txt']);
    assert.equal(outputs['diff-base'], base);
  });

  it('compares new branches with the remote default branch', async () => {
    const main = repo.commit('init', { 'a.txt': 'a' });
    repo.git('checkout', '-q', '-b', 'feature');
    const head = repo.commit('feature', { 'b.txt': 'b' });
    repo.git('update-ref', 'refs/remotes/origin/main', main);
    repo.git('branch', '-q', '-D', 'main');
    const event = { before: ZERO, after: head, repository: { default_branch: 'main' } };
    const { outputs } = await execute(repo.dir, config({ event, paths: ['*.txt', '!a.txt'] }));
    assert.deepEqual(lists(outputs)['changed'], ['b.txt']);
    assert.equal(outputs['diff-base'], main);
  });

  it('accepts explicit revisions', async () => {
    repo.commit('one', { 'a.txt': '1' });
    repo.commit('two', { 'b.txt': '2' });
    const { outputs } = await execute(repo.dir, config({ eventName: 'workflow_dispatch', base: 'HEAD~1', head: 'HEAD' }));
    assert.deepEqual(lists(outputs)['added'], ['b.txt']);
  });

  it('fails in git mode when history is missing', async () => {
    const before = repo.commit('init');
    await assert.rejects(execute(repo.dir, config({ source: 'git', event: { before, after: B } })), /not both available locally; use actions\/checkout with fetch-depth: 0/);
  });

  it('falls back to the API without a local merge base', async () => {
    const head = repo.commit('init', { 'a.txt': 'a' });
    repo.git('checkout', '-q', '--orphan', 'other');
    const base = repo.commit('unrelated', { 'b.txt': 'b' });
    const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
    const { outputs, logs } = await execute(repo.dir, config({ eventName: 'pull_request', event }), [
      { method: 'GET', path: `/repos/o/r/compare/${base}...${head}`, json: { base_commit: { sha: base }, files: [{ filename: 'a.txt', status: 'added' }] } },
    ]);
    assert.equal(outputs['diff-source'], 'api');
    assert.ok(logs.includes('History not available locally; using the GitHub API'));
  });
});

describe('run with the API', () => {
  let dir = '';
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'nogit-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const prEvent = { pull_request: { number: 7, base: { sha: A }, head: { sha: B } } };
  const pullRoute = (headSha: string, changed: number): Route => ({ method: 'GET', path: '/repos/o/r/pulls/7', json: { head: { sha: headSha }, changed_files: changed } });

  it('lists pull request files across pages', async () => {
    const { outputs } = await execute(dir, config({ eventName: 'pull_request', event: prEvent, ignore: ['**.md'] }), [
      pullRoute(B, 3),
      {
        method: 'GET',
        path: '/repos/o/r/pulls/7/files',
        json: [{ filename: 'src/a.ts', status: 'modified' }, { filename: 'README.md', status: 'modified' }],
        headers: { link: '<https://api.github.com/repos/o/r/pulls/7/files2?page=2>; rel="next"' },
      },
      { method: 'GET', path: '/repos/o/r/pulls/7/files2', json: [{ filename: 'lib/b.ts', status: 'renamed', previous_filename: 'b.ts' }] },
    ]);
    assert.deepEqual(lists(outputs), { changed: ['lib/b.ts', 'src/a.ts'], added: [], modified: ['src/a.ts'], deleted: [], renamed: ['lib/b.ts'] });
    assert.equal(outputs['diff-base'], A);
    assert.equal(outputs['diff-head'], B);
    assert.equal(outputs['diff-source'], 'api');
  });

  it('compares the event commits when the pull request moved on', async () => {
    const { outputs, logs } = await execute(dir, config({ eventName: 'pull_request', event: prEvent }), [
      pullRoute('c'.repeat(40), 1),
      { method: 'GET', path: `/repos/o/r/compare/${A}...${B}`, json: { base_commit: { sha: A }, files: [{ filename: 'x', status: 'removed' }, { filename: 'y', status: 'unchanged' }] } },
    ]);
    assert.deepEqual(lists(outputs)['deleted'], ['x']);
    assert.equal(outputs['changed-count'], 1);
    assert.match(logs.join('\n'), /head moved/);
  });

  it('fails instead of truncating large pull requests', async () => {
    await assert.rejects(
      execute(dir, config({ eventName: 'pull_request', event: prEvent }), [pullRoute(B, 3001)]),
      /at most 3000 files for this comparison, so the result would be incomplete; use actions\/checkout with fetch-depth: 0/,
    );
  });

  it('fails instead of truncating large comparisons', async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, status: 'added' }));
    await assert.rejects(
      execute(dir, config({ event: { before: A, after: B } }), [{ method: 'GET', path: `/repos/o/r/compare/${A}...${B}`, json: { base_commit: { sha: A }, files } }]),
      /at most 300 files/,
    );
  });

  it('resolves ref heads to SHAs in API mode', async () => {
    const { outputs } = await execute(dir, config({ source: 'api', eventName: 'workflow_dispatch', base: 'main', head: 'release/1' }), [
      { method: 'GET', path: '/repos/o/r/compare/main...release/1', json: { base_commit: { sha: A } } },
      {
        method: 'GET',
        path: '/repos/o/r/commits/release/1',
        body: `${B}\n`,
        headers: { 'content-type': 'application/vnd.github.sha' },
        check: (req) => assert.equal(req.headers.get('accept'), 'application/vnd.github.sha'),
      },
    ]);
    assert.equal(outputs['diff-base'], A);
    assert.equal(outputs['diff-head'], B);
    assert.equal(outputs['any-changed'], false);
    assert.equal(outputs['changed-files'], '[]');
  });

  it('requires a token and repository for the API', async () => {
    const event = { before: A, after: B };
    await assert.rejects(execute(dir, config({ event, token: '' })), /github-token is required/);
    await assert.rejects(execute(dir, config({ event, repository: undefined })), /GITHUB_REPOSITORY is required/);
  });

  it('returns empty outputs for branch deletions', async () => {
    const { outputs } = await execute(dir, config({ event: { before: A, after: ZERO, deleted: true } }));
    assert.equal(outputs['any-changed'], false);
    assert.equal(outputs['changed-files'], '[]');
    assert.equal(outputs['diff-source'], '');
  });
});
