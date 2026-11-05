// Resolves the commit range to diff from the triggering event.
import { isCommitSha, refNameProblem } from './lib/refname.js';
const ZERO_SHA = /^0+$/;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
function sha(value, field) {
    if (typeof value !== 'string' || !isCommitSha(value))
        throw new Error(`event field '${field}' is not a commit SHA`);
    return value;
}
/** Validates a user-supplied revision such as a SHA, branch, or `HEAD~1`. */
export function revProblem(rev) {
    const name = /^(.*?)(?:[~^]\d*)*$/.exec(rev)?.[1] ?? '';
    return name ? refNameProblem(name) : 'is empty';
}
function eventRange(eventName, event) {
    if (eventName.startsWith('pull_request')) {
        const pr = record(event['pull_request']);
        if (!pr)
            return undefined;
        const number = pr['number'];
        return {
            base: sha(record(pr['base'])?.['sha'], 'pull_request.base.sha'),
            head: sha(record(pr['head'])?.['sha'], 'pull_request.head.sha'),
            mergeBase: true,
            ...(typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? { pull: number } : {}),
        };
    }
    if (eventName === 'merge_group') {
        const group = record(event['merge_group']);
        if (!group)
            return undefined;
        return { base: sha(group['base_sha'], 'merge_group.base_sha'), head: sha(group['head_sha'], 'merge_group.head_sha'), mergeBase: true };
    }
    if (eventName === 'push') {
        const after = event['after'];
        if (event['deleted'] === true || (typeof after === 'string' && ZERO_SHA.test(after)))
            return 'deleted';
        const head = sha(after, 'after');
        const before = event['before'];
        if (typeof before === 'string' && !ZERO_SHA.test(before))
            return { base: sha(before, 'before'), head, mergeBase: false };
        const branch = record(event['repository'])?.['default_branch'];
        if (typeof branch !== 'string' || refNameProblem(branch))
            throw new Error('event field repository.default_branch is missing or invalid');
        return { base: branch, head, mergeBase: true };
    }
    return undefined;
}
/** Returns 'deleted' for branch deletions, which have nothing to diff. */
export function resolveRange(eventName, event, overrides) {
    const fromEvent = eventRange(eventName, event);
    if (fromEvent === 'deleted' && !(overrides.base && overrides.head))
        return 'deleted';
    const range = fromEvent === 'deleted' ? undefined : fromEvent;
    const base = overrides.base || range?.base;
    const head = overrides.head || range?.head;
    if (!base || !head)
        throw new Error(`diff-base and diff-head are required for '${eventName || 'unknown'}' events`);
    const pull = overrides.base || overrides.head ? undefined : range?.pull;
    return { base, head, mergeBase: range?.mergeBase ?? true, ...(pull === undefined ? {} : { pull }) };
}
