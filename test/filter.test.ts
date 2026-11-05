import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compilePattern, matchesAny, PathFilter } from '../src/filter.ts';

const matches = (patterns: string[], path: string): boolean => matchesAny(patterns.map(compilePattern), path);

// Examples from GitHub's "Filter pattern cheat sheet" for `paths`.
const CHEAT_SHEET: [patterns: string[], yes: string[], no: string[]][] = [
  [['*'], ['README.md', 'server.rb'], ['docs/README.md']],
  [['*.jsx?'], ['page.js', 'page.jsx'], ['page.jsxx', 'src/page.js']],
  [['**'], ['all/the/files.md', 'README.md'], []],
  [['*.js'], ['app.js', 'index.js'], ['js/index.js']],
  [['**.js'], ['index.js', 'js/index.js', 'src/js/app.js'], ['index.jsx']],
  [['docs/*'], ['docs/README.md', 'docs/file.txt'], ['docs/mona/octocat.txt', 'README.md']],
  [['docs/**'], ['docs/README.md', 'docs/mona/octocat.txt'], ['src/docs/x.md']],
  [['docs/**/*.md'], ['docs/README.md', 'docs/mona/hello-world.md', 'docs/a/markdown/file.md'], ['docs/file.txt']],
  [['**/docs/**'], ['docs/hello.md', 'dir/docs/my-file.txt', 'space/docs/plan/space.doc'], ['mydocs/x.md']],
  [['**/README.md'], ['README.md', 'js/README.md'], ['README.markdown', 'js/MY-README.md']],
  [['**/*src/**'], ['a/src/app.js', 'my-src/code/js/app.js'], ['src.js', 'a/source/app.js']],
  [['**/*-post.md'], ['my-post.md', 'path/their-post.md'], ['post.md']],
  [['**/migrate-*.sql'], ['migrate-10909.sql', 'db/migrate-v1.0.sql', 'db/sept/migrate-v1.sql'], ['migrate.sql', 'db/migrate-v1.sqlx']],
  [['*.md', '!README.md'], ['hello.md'], ['README.md', 'docs/hello.md']],
  [['*.md', '!README.md', 'README*'], ['hello.md', 'README.md', 'README.doc'], ['docs/hello.md']],
];

describe('compilePattern', () => {
  for (const [patterns, yes, no] of CHEAT_SHEET) {
    it(`matches ${patterns.join(' ')}`, () => {
      for (const path of yes) assert.equal(matches(patterns, path), true, `${path} should match`);
      for (const path of no) assert.equal(matches(patterns, path), false, `${path} should not match`);
    });
  }

  it('treats + as one or more of the preceding character', () => {
    assert.ok(matches(['ab+c'], 'abbbc'));
    assert.ok(!matches(['ab+c'], 'ac'));
    assert.ok(matches(['a*+'], 'abc'));
    assert.ok(!matches(['a*+'], 'a/c'));
  });

  it('matches bracket classes and ranges', () => {
    assert.ok(matches(['[CB]at'], 'Cat'));
    assert.ok(matches(['[1-2]00'], '200'));
    assert.ok(!matches(['[1-2]00'], '300'));
    assert.ok(matches(['[0-9a-z]'], 'q'));
    assert.ok(!matches(['[0-9a-z]'], 'Q'));
    assert.ok(matches(['v[.^\\]-]'], 'v^'));
    assert.ok(matches(['v[.^\\]-]'], 'v-'));
    assert.ok(matches(['v[.^\\]-]'], 'v]'));
  });

  it('honours escapes and literal special characters', () => {
    assert.ok(matches(['a\\*b'], 'a*b'));
    assert.ok(!matches(['a\\*b'], 'axb'));
    assert.ok(matches(['a\\?'], 'a?'));
    assert.ok(matches(['?x'], '?x'));
    assert.ok(matches(['a.b(c)|{d}$^'], 'a.b(c)|{d}$^'));
    assert.ok(!matches(['a.b'], 'axb'));
    assert.ok(matches(['x!y'], 'x!y'));
  });

  it('quantifies whole code points', () => {
    assert.ok(matches(['a😀?b'], 'ab'));
    assert.ok(matches(['a😀+b'], 'a😀😀b'));
  });

  it('only lets ** absorb directories at a segment start', () => {
    assert.ok(matches(['x**/y'], 'xa/y'));
    assert.ok(!matches(['x**/y'], 'xy'));
    assert.ok(matches(['a/**/b'], 'a/b'));
    assert.ok(matches(['a/**/b'], 'a/x/y/b'));
  });

  it('rejects malformed patterns', () => {
    for (const bad of ['', '!', 'a\\', '[ab', '[]', '[z-a]', '[a-Z]', '[!-~]']) assert.throws(() => compilePattern(bad), Error, bad);
  });

  it('uses the last matching pattern', () => {
    assert.ok(!matches(['!a.md'], 'a.md'));
    assert.ok(matches(['!a.md', '*.md'], 'a.md'));
  });
});

describe('PathFilter', () => {
  it('includes everything without patterns', () => {
    assert.ok(new PathFilter([], []).matches('any/thing'));
  });

  it('applies paths then paths-ignore', () => {
    const filter = new PathFilter(['src/**', '!src/gen/**'], ['**.md', '!src/keep.md']);
    assert.ok(filter.matches('src/a.ts'));
    assert.ok(!filter.matches('src/gen/a.ts'));
    assert.ok(!filter.matches('src/notes.md'));
    assert.ok(filter.matches('src/keep.md'));
    assert.ok(!filter.matches('lib/a.ts'));
  });

  it('applies only paths-ignore when paths is empty', () => {
    const filter = new PathFilter([], ['docs/**']);
    assert.ok(filter.matches('src/a.ts'));
    assert.ok(!filter.matches('docs/a.md'));
  });
});
