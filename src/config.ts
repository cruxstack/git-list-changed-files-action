import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Env, Inputs } from './lib/actions.ts';
import { parseRepository } from './lib/refname.ts';
import { revProblem, type Payload } from './event.ts';
import { PathFilter } from './filter.ts';

export const SOURCES = ['auto', 'git', 'api'] as const;
export const FORMATS = ['json', 'text'] as const;

export interface Config {
  token: string;
  repository: { owner: string; repo: string } | undefined;
  cwd: string;
  filter: PathFilter;
  base: string;
  head: string;
  source: (typeof SOURCES)[number];
  format: (typeof FORMATS)[number];
  separator: string;
  eventName: string;
  event: Payload;
}

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', '\\': '\\' };

/** Expands `\n`, `\r`, `\t` and `\\`; other characters are kept as written. */
export function unescape(value: string): string {
  return value.replace(/\\(.)/gs, (match, ch: string) => ESCAPES[ch] ?? match);
}

function revision(inputs: Inputs, name: string): string {
  const value = inputs.get(name);
  const problem = value ? revProblem(value) : undefined;
  if (problem) throw new Error(`${name} '${value}' ${problem}`);
  return value;
}

function readEvent(file: string | undefined): Payload {
  if (!file) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('event payload is not a JSON object');
  return parsed as Payload;
}

export function readConfig(inputs: Inputs, env: Env): Config {
  const workspace = resolve(env['GITHUB_WORKSPACE'] || process.cwd());
  const cwd = resolve(workspace, inputs.string('working-directory', '.'));
  const rel = relative(workspace, cwd);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`working-directory '${inputs.get('working-directory')}' is outside the workspace`);

  const patterns = (name: string): string[] => inputs.list(name);
  let filter: PathFilter;
  try {
    filter = new PathFilter(patterns('paths'), patterns('paths-ignore'));
  } catch (error) {
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
