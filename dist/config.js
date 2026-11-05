import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseRepository } from './lib/refname.js';
import { revProblem } from './event.js';
import { PathFilter } from './filter.js';
export const SOURCES = ['auto', 'git', 'api'];
export const FORMATS = ['json', 'text'];
const ESCAPES = { n: '\n', r: '\r', t: '\t', '\\': '\\' };
/** Expands `\n`, `\r`, `\t` and `\\`; other characters are kept as written. */
export function unescape(value) {
    return value.replace(/\\(.)/gs, (match, ch) => ESCAPES[ch] ?? match);
}
function revision(inputs, name) {
    const value = inputs.get(name);
    const problem = value ? revProblem(value) : undefined;
    if (problem)
        throw new Error(`${name} '${value}' ${problem}`);
    return value;
}
function readEvent(file) {
    if (!file)
        return {};
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('event payload is not a JSON object');
    return parsed;
}
export function readConfig(inputs, env) {
    const workspace = resolve(env['GITHUB_WORKSPACE'] || process.cwd());
    const cwd = resolve(workspace, inputs.string('working-directory', '.'));
    const rel = relative(workspace, cwd);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error(`working-directory '${inputs.get('working-directory')}' is outside the workspace`);
    const patterns = (name) => inputs.list(name);
    let filter;
    try {
        filter = new PathFilter(patterns('paths'), patterns('paths-ignore'));
    }
    catch (error) {
        throw new Error(`invalid path filter: ${error instanceof Error ? error.message : String(error)}`);
    }
    const repository = env['GITHUB_REPOSITORY'];
    const separator = env['INPUT_OUTPUT-SEPARATOR'];
    return {
        token: inputs.get('github-token'),
        repository: repository ? parseRepository(repository) : undefined,
        cwd,
        filter,
        base: revision(inputs, 'diff-base'),
        head: revision(inputs, 'diff-head'),
        source: inputs.choice('diff-source', SOURCES, 'auto'),
        format: inputs.choice('output-format', FORMATS, 'json'),
        // Read raw: whitespace separators are meaningful.
        separator: separator ? unescape(separator) : '\n',
        eventName: env['GITHUB_EVENT_NAME'] ?? '',
        event: readEvent(env['GITHUB_EVENT_PATH']),
    };
}
