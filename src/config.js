'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load .env from the project root regardless of the cwd Claude Code spawns us in.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Expand a leading "~" to the user's home directory.
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

// Build and validate the SSH config once at startup.
function loadConfig() {
  const authMethod = (process.env.SSH_AUTH_METHOD || 'privateKey').trim();
  if (authMethod !== 'privateKey' && authMethod !== 'password') {
    throw new Error(`SSH_AUTH_METHOD must be "privateKey" or "password", got "${authMethod}".`);
  }

  const config = {
    host: required('SSH_HOST'),
    port: parseInt(process.env.SSH_PORT || '22', 10),
    username: required('SSH_USERNAME'),
    authMethod,
    execTimeoutMs: parseInt(process.env.SSH_EXEC_TIMEOUT_MS || '120000', 10),
  };

  if (authMethod === 'password') {
    config.password = required('SSH_PASSWORD');
  } else {
    const keyPath = expandHome(required('SSH_PRIVATE_KEY_PATH'));
    if (!fs.existsSync(keyPath)) {
      throw new Error(`SSH_PRIVATE_KEY_PATH does not exist: ${keyPath}`);
    }
    config.privateKey = fs.readFileSync(keyPath);
    config.keyPath = keyPath;
    const passphrase = (process.env.SSH_PASSPHRASE || '').trim();
    if (passphrase) config.passphrase = passphrase;
  }

  return config;
}

module.exports = { loadConfig };
