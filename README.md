# pr-dashboard-mcp: GitHub pull request dashboard for Claude Code

A **Claude Code plugin** and **MCP server** that show your open **GitHub pull requests** in a pane next to the conversation with Claude: review status, CI checks and who is working on what, grouped by what happens next: needs your review, returned to you, ready to merge, from your team, waiting for review, drafts. It also defines [**pr-work/1**](protocol/README.md), an open protocol that lets AI agents, skills and scripts mark a pull request as in progress.

- **Claude Code** (terminal and the desktop app's Code tab): a one-line summary above the prompt box and a pane beside the chat, with a button that hands each pull request to Claude to review or fix, and a notification when one needs you.
- **Any MCP client**: an MCP server Claude can ask to list, summarise and track pull requests.
- **Anyone**: [pr-work/1](protocol/README.md), an open file protocol any skill, script or AI agent uses to mark a pull request as in progress. The dashboard shows each one with who holds it and what it is doing.

## Requirements

- **Claude Code 2.1.299 or later** for the pane: earlier versions refuse to load it.
- **Node.js 20 or later** on your `PATH`: the MCP server runs on it.
- A GitHub account on github.com or GitHub Enterprise Server, signed in with the [GitHub CLI](https://cli.github.com) or given as a token.

## Install in Claude Code

```
/plugin install pr-dashboard --marketplace AUN-PN/pr-dashboard-mcp
```

Answer `y` to add the marketplace, then pick a scope.

In the desktop app's Code tab: click **+** next to the prompt box → **Plugins** → **Add marketplace** `AUN-PN/pr-dashboard-mcp` → **Add plugin**.

The summary bar above the prompt box shows how many pull requests are open, which one you are working on and which need attention; click it to open the pane. The pane opens when a session starts. Run `/pr-dashboard`, or ask Claude for your dashboard, to open it again.

Each pull request in the pane has one Claude button:

- **✦ Review** runs `/code-review` on it. The review only reads, and its findings arrive in the conversation.
- **✦ Fix** replaces it on your own pull requests whose checks fail or that a reviewer sent back. Claude works on the branch in a separate worktree, fixes it, runs the tests and shows you the change before it pushes.

You are notified when a pull request needs your review, is returned to you, becomes ready to merge, or is opened by your team. Four or more at once arrive as one notification.

Everything reads one list of open pull requests, fetched once per reload: yours, those that request your review, and every open one in your repositories. Your repositories are the ones in the Repositories setting, or, when it is empty, the ones you worked in during the last 30 days. Each pull request lands in one section: **From your team** holds those by other people that request no review from you, without drafts and bots. The sections, the summary bar, the notifications and `list_pending_prs` all count from that list, so they agree.

The pane reloads by itself: every 5 minutes; when you open it or send a prompt and what it shows is over a minute old; and 5 and 30 seconds after Claude runs `git push` or a `gh pr` command that changes a pull request (`create`, `merge`, `close`, `reopen`, `ready`, `edit`, `review`, `comment`). **Refresh** reloads at once.

Everything on this machine updates live, in every open session at once, within about a tenth of a second:

- who is working on which pull request, and each agent's note, however it was written (the buttons, `set_pr_status`, `pr-work.sh`, or any program writing a pr-work/1 file);
- the dashboard, as soon as any session reloads it from GitHub, so several sessions cost about as much as one;
- the one-line summaries, written once and shown everywhere.

The server watches its folders and the pane waits on it, so nothing polls. A session with no screen, such as `claude -p`, does nothing in the background. The server runs with a 128 MB heap limit; it uses about 25 MB.

No setup is needed if you are signed in to the GitHub CLI (`gh auth login`) or have `GH_TOKEN` set. The plugin settings are all optional:

| Setting | Default |
|---------|---------|
| GitHub token | `GH_TOKEN`, then your `gh` login |
| GitHub host | github.com; set your GitHub Enterprise Server host, such as `github.example.com` |
| Repositories | The ones you worked in during the last 30 days; set a list to use those instead |
| Open on start | On |
| Summary bar | On |
| Notifications | On |
| AI summaries | On: one line under each of the first 20 pull requests from the smallest Claude model (the `haiku` alias, so it follows new Haiku releases), written while the pane is open, kept until the pull request changes |

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
      "mcp__plugin_pr-dashboard_pr-dashboard__get_live_updates",
      "mcp__plugin_pr-dashboard_pr-dashboard__set_pr_status",
      "mcp__plugin_pr-dashboard_pr-dashboard__save_pr_summary"
    ]
  }
}
```

The first five only read. `set_pr_status` and `save_pr_summary` write local files, never GitHub.

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

Use an absolute path to `node` (`which node`, or `where node` on Windows): Claude Desktop does not read your shell's `PATH`. Quit Claude Desktop with ⌘Q, reopen it, and ask *"Which pull requests need me?"*. Outside Claude Code the answers are text; the pane is Claude Code only.

Cursor and Windsurf take the same `mcpServers` entry, in `~/.cursor/mcp.json` and `~/.codeium/windsurf/mcp_config.json`. VS Code takes it under `servers` in `.vscode/mcp.json`, with `"type": "stdio"`. The server speaks MCP 2024-11-05 and later.

In a cloud session, such as Claude Code on the web, there is no `gh` login: set `GH_TOKEN` in the environment's variables.

## Token

The server takes the first token it finds, and never writes to GitHub:

1. The plugin's GitHub token setting, or `GITHUB_PERSONAL_ACCESS_TOKEN`.
2. `GH_TOKEN`, then `GITHUB_TOKEN`. On an Enterprise host, `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`.
3. `gh auth token --hostname <host>`.

A token you create can be either:

- Fine-grained, read-only: **Pull requests**, **Contents**, **Commit statuses**.
- Classic, with the `repo` scope.

An organisation with SAML single sign-on hides its pull requests until the token is authorised for it on GitHub. Until then the pane shows the rest, with GitHub's reason above them.

## Tools

| Tool | |
|------|-|
| `list_pending_prs` | The pane's open pull requests by repository; or any repositories and state you name |
| `get_pr_details` | One pull request in full: description, diffs, checks, reviews, comments; or, with `brief`, the description and files in at most 12,000 characters |
| `set_pr_status` | Mark a pull request `working`, `paused`, `done` or `clear` for the user or for an agent (`actor`, `note`, `ttl_minutes`) |
| `get_pr_status` | Who is working on which pull request, from local state only; with `since` and `wait_seconds` it answers the moment that changes |
| `get_dashboard_data` | Everything the pane shows, as structured data, loaded from GitHub and shared with every session |
| `get_live_updates` | Work, the last dashboard any session loaded, and the summaries; with `since` and `wait_seconds` it answers the moment any of them changes |
| `save_pr_summary` | Store a one-line summary every pane shows under the pull request until it changes |

| Environment variable | |
|----------------------|-|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Falls back to `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token` |
| `GITHUB_HOST` | GitHub Enterprise Server host. Falls back to `GH_HOST`, then `github.com` |
| `WATCHED_REPOS` | `owner/repo` list, comma or space separated. Your repositories for the pane and `list_pending_prs`; when empty, the repositories with pull requests involving you in the last 30 days |
| `PR_WORK_DIR` | pr-work records; default `${XDG_STATE_HOME:-~/.local/state}/pr-work` |
| `PR_DASHBOARD_STATE_DIR` | The dashboard and summaries sessions share; default `${XDG_STATE_HOME:-~/.local/state}/pr-dashboard` |

## Agents and skills: pr-work/1

A skill or agent marks the pull request it is on, and every open pane shows it under **In progress** at once:

```bash
protocol/pr-work.sh set acme/web#45 working --actor my-review-skill --note "running tests" --ttl 60
protocol/pr-work.sh set acme/web#45 done --actor my-review-skill --note "passed"
```

The script is POSIX `sh` with no dependencies (on Windows, run it from Git Bash or WSL); copy it into the skill. A `done` record without `--ttl` lasts a day. An MCP client calls `set_pr_status` with its own `actor` instead. Any other language writes one JSON file. [protocol/README.md](protocol/README.md) is the specification and [protocol/pr-work-1.schema.json](protocol/pr-work-1.schema.json) its JSON Schema.

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
