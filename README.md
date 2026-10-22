# pr-dashboard-mcp: GitHub pull request dashboard for Claude Code

A **Claude Code plugin** and **MCP server** that show your open **GitHub pull requests** in a pane next to the conversation with Claude: review status, CI checks and who is working on what, grouped by what happens next: needs your review, returned to you, ready to merge, waiting for review, drafts. It also defines [**pr-work/1**](protocol/README.md), an open protocol that lets AI agents, skills and scripts mark a pull request as in progress.

- **Claude Code** (terminal and the desktop app's Code tab): a one-line summary above the prompt box and a pane beside the chat.
- **Any MCP client**: an MCP server Claude can ask to list, summarise and track pull requests.
- **Anyone**: [pr-work/1](protocol/README.md), an open file protocol any skill, script or AI agent uses to mark a pull request as in progress. The dashboard shows each one with who holds it and what it is doing.

## Install in Claude Code

```
/plugin install pr-dashboard --marketplace AUN-PN/pr-dashboard-mcp
```

Answer `y` to add the marketplace, then pick a scope.

In the desktop app's Code tab: click **+** next to the prompt box → **Plugins** → **Add marketplace** `AUN-PN/pr-dashboard-mcp` → **Add plugin**.

The summary bar above the prompt box shows how many pull requests are open, which one you are working on and which need attention; click it to open the pane. The pane opens when a session starts. Run `/pr-dashboard`, or ask Claude for your dashboard, to open it again.

No setup is needed if you are signed in to the GitHub CLI (`gh auth login`). The plugin settings take an optional token and an optional list of repositories:

| Setting | Default |
|---------|---------|
| GitHub token | Your `gh` login |
| Repositories | All of them; set a list to limit the pane and `list_pending_prs` to those |
| Open on start | On |
| Summary bar | On |
| AI summaries | On: one line under each pull request from the smallest Claude model (the `haiku` alias, so it follows new Haiku releases), kept until the pull request changes |

### Auto mode

Auto mode reviews the plugin's own background calls and refuses them, so the pane shows an error. Allow the plugin's tools in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_pr-dashboard_pr-dashboard__get_dashboard_data",
      "mcp__plugin_pr-dashboard_pr-dashboard__list_pending_prs",
      "mcp__plugin_pr-dashboard_pr-dashboard__get_pr_details",
      "mcp__plugin_pr-dashboard_pr-dashboard__get_pr_status",
      "mcp__plugin_pr-dashboard_pr-dashboard__set_pr_status"
    ]
  }
}
```

The first four only read. `set_pr_status` writes local pr-work files, never GitHub.

## Use the server in another MCP client

The built server is committed, so a clone is enough:

```bash
git clone https://github.com/AUN-PN/pr-dashboard-mcp.git
```

For Claude Desktop, add it to `~/Library/Application Support/Claude/claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "pr-dashboard": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/pr-dashboard-mcp/plugin/server/index.js"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "",
        "WATCHED_REPOS": ""
      }
    }
  }
}
```

Use an absolute path to `node` (`which node`): Claude Desktop does not read your shell's `PATH`. Quit Claude Desktop with ⌘Q, reopen it, and ask *"Which pull requests need me?"*. Outside Claude Code the answers are text; the pane is Claude Code only.

## Token

Leave the token empty to use `gh auth token`. Otherwise either works:

- Fine-grained token, read-only: **Pull requests**, **Contents**, **Commit statuses**.
- Classic token with the `repo` scope.

The server never writes to GitHub.

## Tools

| Tool | |
|------|-|
| `list_pending_prs` | Pull requests across repositories, with review and CI status |
| `get_pr_details` | One pull request in full: description, diffs, checks, reviews, comments |
| `set_pr_status` | Mark a pull request `working`, `paused`, `done` or `clear` for the user or for an agent (`actor`, `note`, `ttl_minutes`) |
| `get_pr_status` | Who is working on which pull request, from local state only |
| `get_dashboard_data` | Everything the pane shows, as structured data |

| Environment variable | |
|----------------------|-|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Falls back to `gh auth token` |
| `WATCHED_REPOS` | `owner/repo` list, comma or space separated. Limits the pane to these repositories, and is what `list_pending_prs` lists; that tool falls back to repositories with pull requests involving you in the last 30 days |
| `PR_WORK_DIR` | pr-work records; default `${XDG_STATE_HOME:-~/.local/state}/pr-work`. The old `~/.pr-dashboard-mcp/state.json` is moved in on first start |

## Agents and skills: pr-work/1

A skill or agent marks the pull request it is on, and the pane shows it under **In progress** within 15 seconds:

```bash
protocol/pr-work.sh set acme/web#45 working --actor my-review-skill --note "running tests" --ttl 60
protocol/pr-work.sh set acme/web#45 done --actor my-review-skill --note "passed"
```

The script is POSIX `sh` with no dependencies; copy it into the skill. An MCP client calls `set_pr_status` with its own `actor` instead. Any other language writes one JSON file. [protocol/README.md](protocol/README.md) is the specification and [protocol/pr-work-1.schema.json](protocol/pr-work-1.schema.json) its JSON Schema.

## Repository

```
.
├── .claude-plugin/marketplace.json   Marketplace entry for /plugin install
├── plugin/
│   ├── .claude-plugin/plugin.json    Manifest and settings
│   ├── .mcp.json                     Starts server/index.js with the settings
│   ├── hooks/                        The pane and the summary bar
│   ├── types/                        State contract
│   └── server/index.js               MCP server, one self-contained file
└── protocol/                         pr-work/1: specification, JSON Schema, reference sh client
```

Run Claude Code with the plugin from a clone:

```bash
claude --plugin-dir ./plugin
```

## License

[MIT](LICENSE)
