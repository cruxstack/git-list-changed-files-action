import { path } from './lib/github.js';
import { resolveRange } from './event.js';
import { HISTORY_HINT, listFromApi, listFromGit, resolveLocal } from './sources.js';
const STATUSES = ['added', 'modified', 'deleted', 'renamed'];
export async function run(config, { git, github, log }) {
    const range = resolveRange(config.eventName, config.event, { base: config.base, head: config.head });
    if (range === 'deleted') {
        log.info('Branch deletion; nothing to compare');
        return outputs(config, [], { base: '', head: '', changes: [] }, '');
    }
    let listing;
    let source = 'git';
    if (config.source !== 'api') {
        const local = await resolveLocal(git, range);
        if (local)
            listing = await listFromGit(git, local, range.mergeBase);
        else if (config.source === 'git')
            throw new Error(`${range.base} and ${range.head} are not both available locally; ${HISTORY_HINT}`);
        else
            log.info('History not available locally; using the GitHub API');
    }
    if (!listing) {
        if (!config.repository)
            throw new Error('GITHUB_REPOSITORY is required for the GitHub API');
        if (!config.token)
            throw new Error('github-token is required for the GitHub API');
        source = 'api';
        listing = await listFromApi(github(), path `/repos/${config.repository.owner}/${config.repository.repo}`, range, log);
    }
    const matched = listing.changes.filter((c) => config.filter.matches(c.path) || (c.previousPath !== undefined && config.filter.matches(c.previousPath)));
    log.info(`${listing.base}${range.mergeBase ? '...' : '..'}${listing.head} via ${source}: ${matched.length} of ${listing.changes.length} change(s) match`);
    return outputs(config, matched, listing, source);
}
function outputs(config, changes, listing, source) {
    const paths = (list) => [...new Set(list.map((c) => c.path))].sort();
    const format = (list) => (config.format === 'json' ? JSON.stringify(list) : list.join(config.separator));
    const changed = paths(changes);
    const result = {
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
