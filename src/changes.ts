// Changed-file records from git and the GitHub API.
import { splitNul } from './lib/git.ts';

export type Status = 'added' | 'modified' | 'deleted' | 'renamed';

export interface Change {
  status: Status;
  path: string;
  /** Old path of a rename. */
  previousPath?: string;
}

/** Parses `git diff --name-status -z -M`; copies count as added and type changes as modified. */
export function parseNameStatus(output: Buffer | string): Change[] {
  const tokens = splitNul(output);
  const changes: Change[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++]!.charAt(0);
    if (code === 'R' || code === 'C') {
      const from = tokens[i++];
      const to = tokens[i++];
      if (from === undefined || to === undefined) throw new Error('truncated git diff output');
      changes.push(code === 'R' ? { status: 'renamed', path: to, previousPath: from } : { status: 'added', path: to });
    } else {
      const path = tokens[i++];
      if (path === undefined) throw new Error('truncated git diff output');
      changes.push({ status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', path });
    }
  }
  return changes;
}

export interface ApiFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export function fromApiFile(file: ApiFile): Change | undefined {
  switch (file.status) {
    case 'added':
    case 'copied':
      return { status: 'added', path: file.filename };
    case 'removed':
      return { status: 'deleted', path: file.filename };
    case 'renamed':
      return file.previous_filename
        ? { status: 'renamed', path: file.filename, previousPath: file.previous_filename }
        : { status: 'added', path: file.filename };
    case 'unchanged':
      return undefined;
    default:
      return { status: 'modified', path: file.filename };
  }
}
