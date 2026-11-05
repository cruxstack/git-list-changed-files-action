import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Inputs } from '../src/lib/actions.ts';
import { readConfig, unescape } from '../src/config.ts';

const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const read = (env: Record<string, string> = {}) => readConfig(new Inputs(env), { GITHUB_WORKSPACE: dir, ...env });

describe('readConfig', () => {
  it('applies defaults', () => {
    const config = read();
    assert.equal(config.token, '');
    assert.equal(config.repository, undefined);
    assert.equal(config.cwd, dir);
    assert.equal(config.base, '');
    assert.equal(config.head, '');
    assert.equal(config.source, 'auto');
    assert.equal(config.format, 'json');
    assert.equal(config.separator, '\n');
    assert.equal(config.eventName, '');
    assert.deepEqual(config.event, {});
    assert.ok(config.filter.matches('anything'));
  });

  it('reads inputs, repository and the event payload', () => {
    const eventFile = join(dir, 'event.json');
    writeFileSync(eventFile, JSON.stringify({ after: 'x' }));
    const config = read({
      'INPUT_GITHUB-TOKEN': 'tok',
      'INPUT_WORKING-DIRECTORY': 'sub/dir',
      INPUT_PATHS: 'src/**\n!src/gen/**',
      'INPUT_PATHS-IGNORE': '**.md',
      'INPUT_DIFF-BASE': 'main',
      'INPUT_DIFF-HEAD': 'HEAD~1',
      'INPUT_DIFF-SOURCE': 'git',
      'INPUT_OUTPUT-FORMAT': 'text',
      'INPUT_OUTPUT-SEPARATOR': ' ',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: eventFile,
    });
    assert.equal(config.token, 'tok');
    assert.equal(config.cwd, join(dir, 'sub/dir'));
    assert.deepEqual(config.repository, { owner: 'o', repo: 'r' });
    assert.equal(config.base, 'main');
    assert.equal(config.head, 'HEAD~1');
    assert.equal(config.source, 'git');
    assert.equal(config.format, 'text');
    assert.equal(config.separator, ' ');
    assert.equal(config.eventName, 'push');
    assert.deepEqual(config.event, { after: 'x' });
    assert.ok(config.filter.matches('src/a.ts'));
    assert.ok(!config.filter.matches('src/gen/a.ts'));
    assert.ok(!config.filter.matches('src/a.md'));
  });

  it('rejects unsafe or invalid values', () => {
    assert.throws(() => read({ 'INPUT_WORKING-DIRECTORY': '../elsewhere' }), /outside the workspace/);
    assert.throws(() => read({ 'INPUT_WORKING-DIRECTORY': '/etc' }), /outside the workspace/);
    assert.throws(() => read({ 'INPUT_WORKING-DIRECTORY': '..' }), /outside the workspace/);
    assert.doesNotThrow(() => read({ 'INPUT_WORKING-DIRECTORY': '..dotted' }));
    assert.throws(() => read({ 'INPUT_DIFF-BASE': '--output=/tmp/x' }), /diff-base '--output=\/tmp\/x' starts with '-'/);
    assert.throws(() => read({ 'INPUT_DIFF-HEAD': 'a..b' }), /diff-head/);
    assert.throws(() => read({ INPUT_PATHS: 'src/[ab' }), /invalid path filter: pattern 'src\/\[ab' has an unclosed/);
    assert.throws(() => read({ 'INPUT_DIFF-SOURCE': 'svn' }), /one of auto, git, api/);
    assert.throws(() => read({ GITHUB_REPOSITORY: 'bad' }), /owner\/name/);
  });

  it('requires the event payload to be an object', () => {
    const eventFile = join(dir, 'array.json');
    writeFileSync(eventFile, '[]');
    assert.throws(() => read({ GITHUB_EVENT_PATH: eventFile }), /not a JSON object/);
  });
});

describe('unescape', () => {
  it('expands common escapes only', () => {
    assert.equal(unescape('\\n'), '\n');
    assert.equal(unescape('a\\tb\\r\\\\'), 'a\tb\r\\');
    assert.equal(unescape('\\,'), '\\,');
    assert.equal(unescape(','), ',');
  });
});
