// Changed-file listing from the local repository or the GitHub API.
import { path } from './lib/github.js';
import { isCommitSha } from './lib/refname.js';
import { fromApiFile, parseNameStatus } from './changes.js';
export const PULL_FILE_LIMIT = 3000;
export const COMPARE_FILE_LIMIT = 300;
export const HISTORY_HINT = 'use actions/checkout with fetch-depth: 0 (or deep enough to include the merge base)';
const capError = (limit) => new Error(`the GitHub API lists at most ${limit} files for this comparison, so the result would be incomplete; ${HISTORY_HINT} for a local diff`);
async function localCommit(git, rev) {
    const candidates = isCommitSha(rev) ? [rev] : [rev, `refs/remotes/origin/${rev}`];
    for (const candidate of candidates) {
        const res = await git.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`], [0, 1, 128]);
        if (res.code === 0)
            return res.stdout.toString('utf8').trim();
    }
    return undefined;
}
/** Resolves both ends (and the merge base when needed) locally; undefined when history is missing. */
export async function resolveLocal(git, range) {
    const base = await localCommit(git, range.base);
    const head = base && (await localCommit(git, range.head));
    if (!base || !head)
        return undefined;
    if (range.mergeBase && (await git.run(['merge-base', '--end-of-options', base, head], [0, 1, 128])).code !== 0)
        return undefined;
    return { base, head };
}
export async function listFromGit(git, local, mergeBase) {
    const spec = mergeBase ? [`${local.base}...${local.head}`] : [local.base, local.head];
    const out = await git.run(['diff', '--name-status', '-z', '-M', '--no-ext-diff', '--no-textconv', '--no-relative', '--end-of-options', ...spec, '--']);
    return { ...local, changes: parseNameStatus(out.stdout) };
}
export async function listFromApi(github, repoPath, range, log) {
    const toChanges = (files) => files.flatMap((f) => fromApiFile(f) ?? []);
    if (range.pull !== undefined) {
        const pull = (await github.request('GET', repoPath + path `/pulls/${range.pull}`)).data;
        if (pull.head.sha === range.head) {
            if (pull.changed_files > PULL_FILE_LIMIT)
                throw capError(PULL_FILE_LIMIT);
            const files = [];
            for await (const file of github.paginate(repoPath + path `/pulls/${range.pull}/files`))
                files.push(file);
            return { base: range.base, head: range.head, changes: toChanges(files) };
        }
        log.info(`Pull request head moved to ${pull.head.sha}; comparing the event's commits instead`);
    }
    const compare = (await github.request('GET', repoPath + path `/compare/${range.base}...${range.head}`)).data;
    const files = compare.files ?? [];
    if (files.length >= COMPARE_FILE_LIMIT)
        throw capError(COMPARE_FILE_LIMIT);
    const head = isCommitSha(range.head)
        ? range.head
        : String((await github.request('GET', repoPath + path `/commits/${range.head}`, { accept: 'application/vnd.github.sha' })).data).trim();
    return { base: compare.base_commit.sha, head, changes: toChanges(files) };
}
