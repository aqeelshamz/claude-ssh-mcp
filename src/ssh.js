'use strict';

const { Client } = require('ssh2');
const { loadConfig } = require('./config');

const config = loadConfig();

let client = null;      // cached ready Client, or null
let connecting = null;  // in-flight connect promise, or null

// Strip ANSI escape sequences and braille spinner chars so log output is clean text.
function cleanOutput(str) {
  return str
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[⠀-⣿]/g, '');
}

function buildConnectConfig() {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    keepaliveInterval: 15000,
    keepaliveCountMax: 240,
    readyTimeout: 30000,
    ...(config.authMethod === 'privateKey'
      ? { privateKey: config.privateKey, ...(config.passphrase ? { passphrase: config.passphrase } : {}) }
      : { password: config.password }),
  };
}

// Lazily connect and cache a single Client. Reconnects automatically after a drop.
function getConnection() {
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {
    const conn = new Client();

    const onReady = () => {
      client = conn;
      connecting = null;
      // Once ready, clear the cache if the connection later dies so we reconnect next time.
      conn.on('end', () => { if (client === conn) client = null; });
      conn.on('close', () => { if (client === conn) client = null; });
      conn.on('error', () => { if (client === conn) client = null; });
      resolve(conn);
    };

    conn.once('ready', onReady);
    conn.once('error', (err) => {
      connecting = null;
      if (client === conn) client = null;
      reject(err);
    });

    conn.connect(buildConnectConfig());
  });

  return connecting;
}

// Run a command on the VPS. Resolves { stdout, stderr, code, signal, timedOut }.
async function exec(command, { timeoutMs, cwd } = {}) {
  const conn = await getConnection();
  const finalCommand = cwd ? `cd ${cwd} && ${command}` : command;
  const limit = timeoutMs || config.execTimeoutMs;

  return new Promise((resolve, reject) => {
    conn.exec(finalCommand, { pty: true }, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try { stream.close(); } catch (_) { /* ignore */ }
      }, limit);

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code, signal) => {
        finish({
          stdout: cleanOutput(stdout),
          stderr: cleanOutput(stderr),
          code: code == null ? null : code,
          signal: signal || null,
          timedOut,
        });
      });
      stream.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  });
}

// Run an operation with an SFTP session.
async function withSftp(fn) {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      Promise.resolve(fn(sftp)).then(resolve, reject);
    });
  });
}

function uploadFile(localPath, remotePath) {
  return withSftp((sftp) => new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  }));
}

function downloadFile(remotePath, localPath) {
  return withSftp((sftp) => new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  }));
}

function close() {
  if (client) {
    try { client.end(); } catch (_) { /* ignore */ }
    client = null;
  }
}

module.exports = { config, exec, uploadFile, downloadFile, close };
