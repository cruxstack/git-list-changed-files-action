import type { Log, OutputValue } from './lib/actions.ts';
import type { Git } from './lib/git.ts';
import { path, type GitHub } from './lib/github.ts';
import type { Change, Status } from './changes.ts';
import type { Config } from './config.ts';
import { resolveRange } from './event.ts';
import { HISTORY_HINT, listFromApi, listFromGit, resolveLocal, type Listing } from './sources.ts';

export interface Deps {
  git: Git;
  /** Created on first use; only the API fallback needs a token. */
  github: () => GitHub;
  log: Log;
}

const STATUSES: readonly Status[] = ['added', 'modified', 'deleted', 'renamed'];

export async function run(config: Config, { git, github, log }: Deps): Promise<Record<string, OutputValue>> {
  const range = resolveRange(config.eventName, config.event, { base: config.base, head: config.head });
  if (range === 'deleted') {
    log.info('Branch deletion; nothing to compare');
    return outputs(config, [], { base: '', head: '', changes: [] }, '');
  }

  let listing: Listing | undefined;
  let source = 'git';
  if (config.source !== 'api') {
    const local = await resolveLocal(git, range);
    if (local) listing = await listFromGit(git, local, range.mergeBase);
    else if (config.source === 'git') throw new Error(`${range.base} and ${range.head} are not both available locally; ${HISTORY_HINT}`);
    else log.info('History not available locally; using the GitHub API');
  }
  if (!listing) {
    if (!config.repository) throw new Error('GITHUB_REPOSITORY is required for the GitHub API');
    if (!config.token) throw new Error('github-token is required for the GitHub API');
    source = 'api';
    listing = await listFromApi(github(), path`/repos/${config.repository.owner}/${config.repository.repo}`, range, log);
  }

  const matched = listing.changes.filter(
    (c) => config.filter.matches(c.path) || (c.previousPath !== undefined && config.filter.matches(c.previousPath)),
  );
  log.info(`${listing.base}${range.mergeBase ? '...' : '..'}${listing.head} via ${source}: ${matched.length} of ${listing.changes.length} change(s) match`);
  return outputs(config, matched, listing, source);
}

function outputs(config: Config, changes: readonly Change[], listing: Listing, source: string): Record<string, OutputValue> {
  const paths = (list: readonly Change[]): string[] => [...new Set(list.map((c) => c.path))].sort();
  const format = (list: readonly string[]): string => (config.format === 'json' ? JSON.stringify(list) : list.join(config.separator));
  const changed = paths(changes);
  const result: Record<string, OutputValue> = {
    'any-changed': changed.length > 0,
    'changed-files': format(changed),
    'changed-count': changed.length,
  };
  for (const status of STATUSES) {
    const list = paths(changes.filter((c) => c.status === status));
    result[`any-${status}`] = list.length > 0;
    result[`${status}-files`] = format(list);
  }
  return { ...result, 'diff-base': listing.base, 'diff-head': listing.head, 'diff-source': source };
}
