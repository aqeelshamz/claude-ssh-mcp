'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const ssh = require('./ssh');

// Format an exec result into human-readable text for Claude.
function formatExecResult({ stdout, stderr, code, signal, timedOut }) {
  const parts = [];
  if (timedOut) parts.push('[timed out — command killed before it finished]');
  parts.push(`exit code: ${code}${signal ? ` (signal ${signal})` : ''}`);
  parts.push(`--- stdout ---\n${stdout || '(empty)'}`);
  if (stderr && stderr.trim()) parts.push(`--- stderr ---\n${stderr}`);
  return parts.join('\n');
}

function text(content) {
  return { content: [{ type: 'text', text: content }] };
}

function errorText(content) {
  return { content: [{ type: 'text', text: content }], isError: true };
}

function buildServer() {
  const server = new McpServer({ name: 'claude-ssh', version: '1.0.0' });

  server.registerTool(
    'ssh_exec',
    {
      title: 'Run a command on the VPS',
      description:
        `Run a shell command on the configured VPS (${ssh.config.username}@${ssh.config.host}) over SSH and return its stdout, stderr, and exit code. ` +
        'Use this to fetch logs (journalctl, docker logs, tail), check status (systemctl, docker ps), or inspect the server. ' +
        'Avoid interactive or never-ending commands (e.g. `tail -f`); bound them (e.g. `journalctl -n 200`, `tail -n 200`).',
      inputSchema: {
        command: z.string().describe('The shell command to run on the VPS.'),
        cwd: z.string().optional().describe('Optional working directory to cd into first.'),
        timeout_ms: z.number().int().positive().optional().describe('Optional timeout in ms (defaults to configured value).'),
      },
    },
    async ({ command, cwd, timeout_ms }) => {
      try {
        const result = await ssh.exec(command, { cwd, timeoutMs: timeout_ms });
        return text(formatExecResult(result));
      } catch (err) {
        return errorText(`SSH exec failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'ssh_read_file',
    {
      title: 'Read a file from the VPS',
      description:
        'Read the contents of a file on the VPS. If max_bytes is given, returns the last max_bytes bytes (handy for large log files).',
      inputSchema: {
        path: z.string().describe('Absolute path to the file on the VPS.'),
        max_bytes: z.number().int().positive().optional().describe('If set, return only the last N bytes of the file.'),
      },
    },
    async ({ path: remotePath, max_bytes }) => {
      const quoted = `'${remotePath.replace(/'/g, `'\\''`)}'`;
      const command = max_bytes ? `tail -c ${max_bytes} ${quoted}` : `cat ${quoted}`;
      try {
        const result = await ssh.exec(command);
        if (result.code !== 0) {
          return errorText(`Could not read file (exit ${result.code}):\n${result.stderr || result.stdout}`);
        }
        return text(result.stdout || '(empty file)');
      } catch (err) {
        return errorText(`SSH read failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'ssh_upload_file',
    {
      title: 'Upload a local file to the VPS',
      description: 'Upload a file from this machine to the VPS over SFTP.',
      inputSchema: {
        local_path: z.string().describe('Path to the local file to upload.'),
        remote_path: z.string().describe('Destination absolute path on the VPS.'),
      },
    },
    async ({ local_path, remote_path }) => {
      try {
        await ssh.uploadFile(local_path, remote_path);
        return text(`Uploaded ${local_path} -> ${remote_path}`);
      } catch (err) {
        return errorText(`SFTP upload failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'ssh_download_file',
    {
      title: 'Download a file from the VPS',
      description: 'Download a file from the VPS to this machine over SFTP.',
      inputSchema: {
        remote_path: z.string().describe('Path to the file on the VPS.'),
        local_path: z.string().describe('Destination path on this machine.'),
      },
    },
    async ({ remote_path, local_path }) => {
      try {
        await ssh.downloadFile(remote_path, local_path);
        return text(`Downloaded ${remote_path} -> ${local_path}`);
      } catch (err) {
        return errorText(`SFTP download failed: ${err.message}`);
      }
    }
  );

  return server;
}

async function runSelfTest() {
  process.stderr.write(`Connecting to ${ssh.config.username}@${ssh.config.host}:${ssh.config.port} (${ssh.config.authMethod})...\n`);
  try {
    const result = await ssh.exec('uname -a && echo "--- claude-ssh selftest OK ---"');
    process.stderr.write(`exit code: ${result.code}\n`);
    process.stdout.write(result.stdout + '\n');
    if (result.stderr && result.stderr.trim()) process.stderr.write('stderr:\n' + result.stderr + '\n');
    ssh.close();
    process.exit(result.code === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`Self-test failed: ${err.message}\n`);
    ssh.close();
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes('--selftest')) {
    await runSelfTest();
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so we don't corrupt the stdio JSON-RPC channel.
  process.stderr.write(`claude-ssh MCP server ready (target: ${ssh.config.username}@${ssh.config.host}).\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
