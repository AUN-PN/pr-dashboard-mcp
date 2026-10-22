# pr-work/1

A local, tool-neutral way for people, scripts, skills and AI agents to say "I am working on this pull request". Any program that can write a JSON file can take part: no server, no SDK, no lock.

The PR Dashboard reads it and shows every record under **In progress** and **Paused**. Nothing in the protocol depends on the dashboard.

## Directory

```
$PR_WORK_DIR                         default: ${XDG_STATE_HOME:-~/.local/state}/pr-work
└── <owner>/<repo>/<number>/<actor>.json
```

`owner` and `repo` are lowercase. One file per pull request per actor, so writers never touch each other's files.

## Record

```json
{
  "protocol": "pr-work/1",
  "repo": "acme/web",
  "number": 45,
  "status": "working",
  "actor": "review-skill",
  "label": "Review skill",
  "note": "running the test suite",
  "updatedAt": "2026-10-22T08:00:00Z",
  "expiresAt": "2026-10-22T09:00:00Z"
}
```

| Field | Required | |
|-------|----------|-|
| `protocol` | yes | Always `pr-work/1` |
| `repo` | yes | `owner/repo` on the GitHub host the readers use |
| `number` | yes | Pull request number |
| `status` | yes | `working`, `paused` or `done` |
| `actor` | yes | Who holds the record; matches the file name. `[a-z0-9][a-z0-9._-]{0,63}` |
| `label` | no | Display name for `actor` |
| `note` | no | One line on what is happening now |
| `updatedAt` | yes | RFC 3339 UTC |
| `expiresAt` | no | RFC 3339 UTC; after it the record counts as absent |

[`pr-work-1.schema.json`](pr-work-1.schema.json) is the JSON Schema.

## Rules

1. **Write atomically.** Write a temporary file in the same directory, then rename it over `<actor>.json`.
2. **Own your file.** Write and delete only files named after your own `actor`.
3. **Clear by deleting.** Remove your file when you no longer hold the pull request. A `done` record says you finished: give it a lease as well, so it does not stay forever (the reference clients keep it for a day).
4. **Lease when you can crash.** Agents set `expiresAt` and write the record again before it passes. Readers ignore expired records and may delete them.
5. **`user` is the human.** The actor `user` is the person at this machine and holds at most one `working` record: a writer that sets one `user` record to `working` sets the others to `paused`. Every other actor may work on many pull requests at once.
6. **Ignore what you do not know.** Readers skip unknown fields, unknown statuses and files that do not parse. New fields never change the meaning of existing ones; a breaking change becomes `pr-work/2`.

## Writing a record

From a shell, with [`pr-work.sh`](pr-work.sh) (POSIX `sh`, no dependencies; copy it into your project):

```bash
pr-work.sh set acme/web#45 working --actor review-skill --label "Review skill" --note "checks" --ttl 60
pr-work.sh set acme/web#45 paused  --actor review-skill --note "waiting for go"
pr-work.sh set acme/web#45 done    --actor review-skill --note "passed"
pr-work.sh clear acme/web#45 --actor review-skill
pr-work.sh list
```

From an MCP client connected to the PR Dashboard server, call `set_pr_status` and `get_pr_status`; they read and write the same files.

From any other language, write the JSON above to the path above.
