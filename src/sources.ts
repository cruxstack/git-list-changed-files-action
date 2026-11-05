// Changed-file listing from the local repository or the GitHub API.
import { path, type GitHub } from './lib/github.ts';
import type { Log } from './lib/actions.ts';
import type { Git } from './lib/git.ts';
import { isCommitSha } from './lib/refname.ts';
import { fromApiFile, parseNameStatus, type ApiFile, type Change } from './changes.ts';
import type { Range } from './event.ts';

export interface Listing {
  base: string;
  head: string;
  changes: Change[];
}

export const PULL_FILE_LIMIT = 3000;
export const COMPARE_FILE_LIMIT = 300;
export const HISTORY_HINT = 'use actions/checkout with fetch-depth: 0 (or deep enough to include the merge base)';

const capError = (limit: number): Error =>
  new Error(`the GitHub API lists at most ${limit} files for this comparison, so the result would be incomplete; ${HISTORY_HINT} for a local diff`);

async function localCommit(git: Git, rev: string): Promise<string | undefined> {
  const candidates = isCommitSha(rev) ? [rev] : [rev, `refs/remotes/origin/${rev}`];
  for (const candidate of candidates) {
    const res = await git.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`], [0, 1, 128]);
    if (res.code === 0) return res.stdout.toString('utf8').trim();
  }
  return undefined;
}

/** Resolves both ends (and the merge base when needed) locally; undefined when history is missing. */
export async function resolveLocal(git: Git, range: Range): Promise<{ base: string; head: string } | undefined> {
  const base = await localCommit(git, range.base);
  const head = base && (await localCommit(git, range.head));
  if (!base || !head) return undefined;
  if (range.mergeBase && (await git.run(['merge-base', '--end-of-options', base, head], [0, 1, 128])).code !== 0) return undefined;
  return { base, head };
}

export async function listFromGit(git: Git, local: { base: string; head: string }, mergeBase: boolean): Promise<Listing> {
  const spec = mergeBase ? [`${local.base}...${local.head}`] : [local.base, local.head];
  const out = await git.run(['diff', '--name-status', '-z', '-M', '--no-ext-diff', '--no-textconv', '--no-relative', '--end-of-options', ...spec, '--']);
  return { ...local, changes: parseNameStatus(out.stdout) };
}

interface Compare {
  base_commit: { sha: string };
  files?: ApiFile[];
}

export async function listFromApi(github: GitHub, repoPath: string, range: Range, log: Log): Promise<Listing> {
  const toChanges = (files: readonly ApiFile[]): Change[] => files.flatMap((f) => fromApiFile(f) ?? []);

  if (range.pull !== undefined) {
    const pull = (await github.request<{ head: { sha: string }; changed_files: number }>('GET', repoPath + path`/pulls/${range.pull}`)).data;
    if (pull.head.sha === range.head) {
      if (pull.changed_files > PULL_FILE_LIMIT) throw capError(PULL_FILE_LIMIT);
      const files: ApiFile[] = [];
      for await (const file of github.paginate<ApiFile>(repoPath + path`/pulls/${range.pull}/files`)) files.push(file);
      return { base: range.base, head: range.head, changes: toChanges(files) };
    }
    log.info(`Pull request head moved to ${pull.head.sha}; comparing the event's commits instead`);
  }

  const compare = (await github.request<Compare>('GET', repoPath + path`/compare/${range.base}...${range.head}`)).data;
  const files = compare.files ?? [];
  if (files.length >= COMPARE_FILE_LIMIT) throw capError(COMPARE_FILE_LIMIT);
  const head = isCommitSha(range.head)
    ? range.head
    : String((await github.request<string>('GET', repoPath + path`/commits/${range.head}`, { accept: 'application/vnd.github.sha' })).data).trim();
  return { base: compare.base_commit.sha, head, changes: toChanges(files) };
}
