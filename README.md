# git-list-changed-files-action

Lists files changed by a push, pull request or merge group, filtered with the same patterns as
workflow `on.push.paths`. It reads the diff from the local checkout and falls back to the GitHub
API when that history isn't available.

- With the history checked out, there are no file limits and no API calls.
- The API fallback fails the step instead of returning a truncated list.
- Never fetches, pushes or touches git credentials.
- No runtime dependencies. The token is only ever sent to the GitHub API.

## Usage

```yaml
on:
  pull_request:

permissions: {}

jobs:
  changes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false

      - id: changes
        uses: cruxstack/git-list-changed-files-action@<full-commit-sha> # v1.0.0
        with:
          paths: |
            src/**
            !src/**/*.test.ts

      - if: steps.changes.outputs.any-changed == 'true'
        env:
          FILES: ${{ steps.changes.outputs.changed-files }}
        run: jq -r '.[]' <<< "$FILES"
```

Pin the action to a full commit SHA. Release tags are immutable.

Use `fetch-depth: 0`, or a depth that includes the merge base, for a local diff. With the default
shallow checkout the action uses the API, which lists at most 3,000 files for a pull request and
300 for other comparisons.

File names come from the repository and, in pull requests, from contributors. Pass list outputs
through `env:` as above; never place `${{ }}` expressions for them inside `run:`.

## Inputs

| Name | Default | Description |
|---|---|---|
| `github-token` | `github.token` | Used only by the API fallback. Needs `contents: read`, plus `pull-requests: read` for pull requests. |
| `working-directory` | `.` | Repository checkout to diff, relative to the workspace. |
| `paths` | | Patterns to include, one per line. Empty includes every file. |
| `paths-ignore` | | Patterns to exclude, one per line. |
| `diff-base` | from the event | Base commit or ref, e.g. `main` or `HEAD~1`. |
| `diff-head` | from the event | Head commit or ref. |
| `diff-source` | `auto` | `auto`, `git` or `api`. |
| `output-format` | `json` | `json` (arrays) or `text`. |
| `output-separator` | `\n` | Separator for `text` lists. Supports `\n`, `\r`, `\t` and `\\`. |

## Outputs

| Name | Description |
|---|---|
| `any-changed` | Whether any matching file changed. |
| `any-added` | Whether any matching file was added. |
| `any-modified` | Whether any matching file was modified. |
| `any-deleted` | Whether any matching file was deleted. |
| `any-renamed` | Whether any matching file was renamed. |
| `changed-files` | Added, modified, deleted and renamed files. |
| `added-files` | Added files, including copies. |
| `modified-files` | Modified files, including type changes. |
| `deleted-files` | Deleted files. |
| `renamed-files` | New paths of renamed files. |
| `changed-count` | Number of files in `changed-files`. |
| `diff-base` | Base commit that was compared. |
| `diff-head` | Head commit that was compared. |
| `diff-source` | `git` or `api`; empty for branch deletions. |

Lists are sorted and contain each path once. `changed-files` includes deleted files, so it can
name paths that no longer exist; use `added-files`, `modified-files` and `renamed-files` for files
present at the head.

## How changes are found

| Event | Compared |
|---|---|
| `pull_request`, `pull_request_target` and other `pull_request_*` events | `base.sha...head.sha` |
| `merge_group` | `base_sha...head_sha` |
| `push` | `before..after` |
| `push` that creates a branch or tag | `<default branch>...after` |
| `push` that deletes a branch | Nothing; lists are empty. |
| Any other event | `diff-base...diff-head`; both are required. |

`base...head` compares from the merge base, so changes made on the base branch meanwhile are left
out. `diff-base` and `diff-head` replace either end of the event's range.

With `diff-source: auto`, git is used when both commits (and the merge base, where needed) exist
locally; a branch name is also looked up as `origin/<name>`. Otherwise the API is used:

- Pull request events use the pull request files API, unless the pull request has moved past the
  event's head.
- Everything else uses the compare API, which always compares from the merge base, including for
  force pushes.

If the API's file limit is reached, the step fails rather than return an incomplete list.
`diff-source: git` fails when the history is missing.

Copies count as added and type changes as modified. A rename matches the filters when either its
old or new path matches.

## Path patterns

Patterns follow GitHub's workflow filter syntax:

| Pattern | Matches |
|---|---|
| `*` | Any characters except `/`. |
| `**` | Any characters, including `/`. A leading `**/` also matches the top level. |
| `?` | Zero or one of the preceding character. |
| `+` | One or more of the preceding character. |
| `[a-z0-9]` | One listed character or range (`a-z`, `A-Z`, `0-9`). |
| `\` | Escapes the next character. |
| `!` | At the start, excludes paths matched by earlier patterns. |

Patterns apply in order and the last match wins, so a list with only `!` patterns matches
nothing. A file is included when it matches `paths` (or `paths` is empty) and does not match
`paths-ignore`.

## Development

```sh
npm ci
npm test           # builds, then runs all tests offline
npm run coverage   # tests with coverage thresholds
```

Commit `dist/` together with source changes; CI fails when it is stale.

## License

[MIT](LICENSE)

## Acknowledgements

Thanks to [tj-actions/changed-files](https://github.com/tj-actions/changed-files), which inspired
this action.
