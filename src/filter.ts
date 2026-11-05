// Path filters with the same semantics as workflow `on.push.paths` / `paths-ignore`.

export interface Pattern {
  source: string;
  negate: boolean;
  regex: RegExp;
}

const SYNTAX = /[\\^$.*+?()[\]{}|/]/;
const escapeChar = (ch: string): string => (SYNTAX.test(ch) ? `\\${ch}` : ch);
const ALNUM_RANGES = [/^[a-z]$/, /^[A-Z]$/, /^[0-9]$/];

// `*` excludes `/`; `**` matches anything, and a leading `**` plus slash may match no directories;
// `?` and `+` quantify the preceding character; `[...]` matches one listed character or range;
// `\` escapes; a leading `!` negates.
export function compilePattern(source: string): Pattern {
  const chars = Array.from(source);
  const negate = chars[0] === '!';
  let i = negate ? 1 : 0;
  if (i >= chars.length) throw new Error(`pattern '${source}' is empty`);
  const atoms: string[] = [];

  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === '*') {
      if (chars[i + 1] === '*') {
        const atSegmentStart = atoms.length === 0 || atoms.at(-1) === '\\/';
        if (atSegmentStart && chars[i + 2] === '/') {
          atoms.push('(?:.*/)?');
          i += 3;
        } else {
          atoms.push('.*');
          i += 2;
        }
      } else {
        atoms.push('[^/]*');
        i += 1;
      }
    } else if (ch === '?' || ch === '+') {
      const previous = atoms.pop();
      atoms.push(previous === undefined ? escapeChar(ch) : `(?:${previous})${ch}`);
      i += 1;
    } else if (ch === '[') {
      const [cls, next] = compileClass(chars, i, source);
      atoms.push(cls);
      i = next;
    } else if (ch === '\\') {
      const next = chars[i + 1];
      if (next === undefined) throw new Error(`pattern '${source}' ends with '\\'`);
      atoms.push(escapeChar(next));
      i += 2;
    } else {
      atoms.push(escapeChar(ch));
      i += 1;
    }
  }
  return { source, negate, regex: new RegExp(`^${atoms.join('')}$`, 'u') };
}

function compileClass(chars: readonly string[], start: number, source: string): [string, number] {
  let body = '';
  let i = start + 1;
  while (i < chars.length && chars[i] !== ']') {
    let ch = chars[i]!;
    if (ch === '\\') {
      const next = chars[i + 1];
      if (next === undefined) break;
      ch = next;
      i += 1;
    }
    const end = chars[i + 2];
    if (chars[i + 1] === '-' && end !== undefined && end !== ']') {
      if (!ALNUM_RANGES.some((r) => r.test(ch) && r.test(end)) || ch > end) {
        throw new Error(`pattern '${source}' has an invalid range '${ch}-${end}'`);
      }
      body += `${ch}-${end}`;
      i += 3;
    } else {
      body += /[\\\]\[^-]/.test(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  if (chars[i] !== ']') throw new Error(`pattern '${source}' has an unclosed '['`);
  if (!body) throw new Error(`pattern '${source}' has an empty '[]'`);
  return [`[${body}]`, i + 1];
}

/** Ordered evaluation: the last matching pattern decides. */
export function matchesAny(patterns: readonly Pattern[], path: string): boolean {
  let matched = false;
  for (const p of patterns) {
    if (p.regex.test(path)) matched = !p.negate;
  }
  return matched;
}

export class PathFilter {
  readonly include: readonly Pattern[];
  readonly exclude: readonly Pattern[];

  constructor(include: readonly string[], exclude: readonly string[]) {
    this.include = include.map(compilePattern);
    this.exclude = exclude.map(compilePattern);
  }

  /** Empty `include` means every path. */
  matches(path: string): boolean {
    return (this.include.length === 0 || matchesAny(this.include, path)) && !matchesAny(this.exclude, path);
  }
}
