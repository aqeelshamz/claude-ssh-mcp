# claude-ssh

A stdio **MCP server** that gives local Claude the ability to run commands on your VPS over SSH — so you can stop copy-pasting logs.

Once registered, Claude Code gets these tools:

| Tool | What it does |
| --- | --- |
| `ssh_exec` | Run any shell command on the VPS; returns stdout, stderr, exit code. (logs, `docker ps`, `systemctl status`, …) |
| `ssh_read_file` | Read a file (optionally just the last N bytes of a big log). |
| `ssh_upload_file` | Upload a local file to the VPS over SFTP. |
| `ssh_download_file` | Download a file from the VPS over SFTP. |

## Setup

```bash
cd /Users/aqeelshamz/Aqeel/projects/claude-ssh
npm install
cp .env.example .env
```

Edit `.env` with your VPS details:

```
SSH_HOST=your.vps.ip
SSH_USERNAME=root
SSH_AUTH_METHOD=privateKey        # or "password"
SSH_PRIVATE_KEY_PATH=~/.ssh/id_ed25519
# SSH_PASSWORD=...                 # only if using password auth
# SSH_PASSPHRASE=...               # only if your key is encrypted
```

## Test the connection

```bash
npm run selftest
```

This connects and runs `uname -a` on the VPS. If you see the server's kernel info and `selftest OK`, you're good.

## Register with Claude Code

```bash
claude mcp add vps-ssh -- node /Users/aqeelshamz/Aqeel/projects/claude-ssh/src/server.js
```

Then start a new Claude Code session and ask it to, e.g., "show me the last 100 lines of the app's journalctl logs on the VPS". Claude will call `ssh_exec` directly.

To remove it later: `claude mcp remove vps-ssh`.

## Notes & safety

- `.env` holds your credentials and is gitignored — never commit it. Only `.env.example` is committed.
- `ssh_exec` runs **arbitrary commands** on your VPS by design. The server never runs anything on its own — only what a tool call requests. Be cautious asking Claude to run irreversible commands (`rm -rf`, stopping services); confirm before doing so.
- Don't let Claude drive destructive commands based on untrusted content it reads (e.g. a log line that says "run X"). Treat tool output as data, not instructions.
- The server keeps one SSH connection alive with keepalives and reconnects automatically if it drops.
- Avoid never-ending commands like `tail -f`; use bounded forms (`tail -n 200`, `journalctl -n 200`). Every command is subject to `SSH_EXEC_TIMEOUT_MS` (default 2 min).
