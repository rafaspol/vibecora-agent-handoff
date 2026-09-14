import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAGIC = 'VAHCP1\n';
const SECRET_BASENAMES = new Set([
  '.env',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
  'secrets',
  'secrets.json',
]);
const SECRET_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx']);
const SECRET_NAME = /(^|[._-])(credential|credentials|secret|secrets|token|tokens)($|[._-])/i;

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function git(args, cwd) {
  return run('git', args, cwd).trim();
}

function optionalGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function gitRaw(args, cwd) {
  return run('git', args, cwd, { encoding: null });
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function write(file, contents, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, mode ? { mode } : undefined);
}

function splitZero(bytes) {
  return bytes
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

export function isCredentialPath(relativePath) {
  const base = path.posix.basename(relativePath.replaceAll('\\', '/')).toLowerCase();
  if (base === '.env.example') return false;
  if (base.startsWith('.env.')) return true;
  return (
    SECRET_BASENAMES.has(base) ||
    SECRET_EXTENSIONS.has(path.extname(base)) ||
    SECRET_NAME.test(base)
  );
}

export function decodeCheckpointKey(value) {
  if (!value) throw new Error('Chave de checkpoint ausente.');
  const trimmed = value.trim();
  const bytes = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (bytes.length !== 32) {
    throw new Error('A chave de checkpoint precisa ter exatamente 32 bytes.');
  }
  return bytes;
}

export function loadCheckpointKey({ keyEnv = 'VIBE_CORA_TASK_KEY', keyFile } = {}) {
  const fromEnv = process.env[keyEnv];
  if (fromEnv) return decodeCheckpointKey(fromEnv);
  const defaultFile = path.join(
    os.homedir(),
    '.config',
    'vibecora-agent-handoff',
    'task-key',
  );
  const file = keyFile || process.env.VIBE_CORA_TASK_KEY_FILE || defaultFile;
  if (!fs.existsSync(file)) {
    throw new Error(`Chave ausente: defina ${keyEnv} ou instale ${file}.`);
  }
  return decodeCheckpointKey(fs.readFileSync(file, 'utf8'));
}

function changedPaths(cwd, base) {
  const groups = [
    base ? gitRaw(['diff', '--name-only', '-z', `${base}..HEAD`], cwd) : Buffer.alloc(0),
    gitRaw(['diff', '--cached', '--name-only', '-z'], cwd),
    gitRaw(['diff', '--name-only', '-z'], cwd),
    gitRaw(['ls-files', '--others', '--exclude-standard', '-z'], cwd),
  ];
  return [...new Set(groups.flatMap(splitZero))].sort();
}

function fileRecord(cwd, relativePath) {
  const absolute = path.join(cwd, relativePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    return { path: relativePath, type: 'symlink', target: fs.readlinkSync(absolute) };
  }
  return {
    path: relativePath,
    type: stat.mode & 0o111 ? 'executable' : 'file',
    mode: stat.mode & 0o777,
    sha256: hash(fs.readFileSync(absolute)),
  };
}

function trackedAndAllowedUntracked(cwd, untracked) {
  const tracked = splitZero(gitRaw(['ls-files', '-z'], cwd));
  return [...new Set([...tracked, ...untracked])]
    .filter((relativePath) => fs.existsSync(path.join(cwd, relativePath)))
    .sort();
}

function capturePatch(cwd, file, args) {
  const fd = fs.openSync(file, 'w');
  try {
    run('git', args, cwd, { encoding: null, stdio: ['ignore', fd, 'pipe'] });
  } finally {
    fs.closeSync(fd);
  }
}

function createPayload(cwd) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-checkpoint-'));
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload);
  const remoteMain = optionalGit(
    ['rev-parse', '--verify', '--quiet', 'origin/main'],
    cwd,
  );
  const base = remoteMain
    ? git(['merge-base', 'origin/main', 'HEAD'], cwd)
    : git(['rev-list', '--max-parents=0', 'HEAD'], cwd).split('\n')[0];
  const head = git(['rev-parse', 'HEAD'], cwd);
  const sensitive = changedPaths(cwd, base).filter(isCredentialPath);
  if (sensitive.length > 0) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`Checkpoint recusado por caminho de credencial: ${sensitive.join(', ')}.`);
  }

  const staged = path.join(payload, 'staged.patch');
  const unstaged = path.join(payload, 'unstaged.patch');
  capturePatch(cwd, staged, ['diff', '--cached', '--binary', 'HEAD']);
  capturePatch(cwd, unstaged, ['diff', '--binary']);

  const untracked = splitZero(
    gitRaw(['ls-files', '--others', '--exclude-standard', '-z'], cwd),
  );
  const allowedUntracked = untracked.filter((item) => !isCredentialPath(item)).sort();
  const rejectedUntracked = untracked.filter(isCredentialPath);
  if (rejectedUntracked.length > 0) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(
      `Checkpoint recusado por arquivo não rastreado de credencial: ${rejectedUntracked.join(', ')}.`,
    );
  }

  const listFile = path.join(root, 'untracked.list');
  write(listFile, Buffer.from(`${allowedUntracked.join('\0')}${allowedUntracked.length ? '\0' : ''}`));
  const untrackedTar = path.join(payload, 'untracked.tar');
  run('tar', ['--null', '-T', listFile, '-cf', untrackedTar], cwd);

  let bundle = null;
  const unpublished = Number(git(['rev-list', '--count', `${base}..HEAD`], cwd));
  if (unpublished > 0) {
    bundle = path.join(payload, 'commits.bundle');
    run('git', ['bundle', 'create', bundle, 'HEAD', `^${base}`], cwd);
  }

  const files = trackedAndAllowedUntracked(cwd, allowedUntracked).map((item) =>
    fileRecord(cwd, item),
  );
  const manifest = {
    version: 1,
    baseSha: base,
    headSha: head,
    remoteUrl: optionalGit(['remote', 'get-url', 'origin'], cwd),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    unpublishedCommits: unpublished,
    stagedPatchSha256: hash(fs.readFileSync(staged)),
    unstagedPatchSha256: hash(fs.readFileSync(unstaged)),
    untrackedTarSha256: hash(fs.readFileSync(untrackedTar)),
    bundleSha256: bundle ? hash(fs.readFileSync(bundle)) : null,
    files,
  };
  write(path.join(payload, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, payload, manifest };
}

function encryptPayload(payload, key, outputPath) {
  const archive = path.join(path.dirname(payload), 'payload.tar.gz');
  run('tar', ['-czf', archive, '-C', payload, '.'], payload);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(fs.readFileSync(archive)),
    cipher.final(),
  ]);
  const header = Buffer.from(
    `${JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') })}\n`,
  );
  write(outputPath, Buffer.concat([Buffer.from(MAGIC), header, ciphertext]), 0o600);
}

function decryptEnvelope(envelope, key) {
  if (!envelope.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) {
    throw new Error('Checkpoint com assinatura inválida.');
  }
  const headerStart = MAGIC.length;
  const headerEnd = envelope.indexOf(10, headerStart);
  if (headerEnd < 0) throw new Error('Checkpoint sem cabeçalho.');
  const header = JSON.parse(envelope.subarray(headerStart, headerEnd).toString('utf8'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(header.nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
  return Buffer.concat([
    decipher.update(envelope.subarray(headerEnd + 1)),
    decipher.final(),
  ]);
}

export function captureCheckpoint({
  cwd,
  outputPath,
  key,
  maxBytes = 25 * 1024 * 1024,
}) {
  const captured = createPayload(cwd);
  try {
    encryptPayload(captured.payload, key, outputPath);
    const bytes = fs.statSync(outputPath).size;
    if (bytes > maxBytes) {
      fs.rmSync(outputPath, { force: true });
      throw new Error(`Checkpoint de ${bytes} bytes excede o teto de ${maxBytes}.`);
    }
    return {
      bytes,
      sha256: hash(fs.readFileSync(outputPath)),
      headSha: captured.manifest.headSha,
      baseSha: captured.manifest.baseSha,
      unpublishedCommits: captured.manifest.unpublishedCommits,
    };
  } finally {
    fs.rmSync(captured.root, { recursive: true, force: true });
  }
}

function verifyPayload(payload) {
  const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json'), 'utf8'));
  const checks = [
    ['staged.patch', manifest.stagedPatchSha256],
    ['unstaged.patch', manifest.unstagedPatchSha256],
    ['untracked.tar', manifest.untrackedTarSha256],
  ];
  if (manifest.bundleSha256) checks.push(['commits.bundle', manifest.bundleSha256]);
  for (const [name, expected] of checks) {
    if (hash(fs.readFileSync(path.join(payload, name))) !== expected) {
      throw new Error(`Hash inválido no checkpoint: ${name}.`);
    }
  }
  return manifest;
}

function assertRestoredFiles(destination, expected) {
  for (const record of expected) {
    const absolute = path.join(destination, record.path);
    if (!fs.existsSync(absolute)) throw new Error(`Arquivo não restaurado: ${record.path}.`);
    if (record.type !== 'symlink') fs.chmodSync(absolute, record.mode);
    const actual = fileRecord(destination, record.path);
    if (JSON.stringify(actual) !== JSON.stringify(record)) {
      throw new Error(`Conteúdo ou modo divergente após restaurar: ${record.path}.`);
    }
  }
}

export function restoreCheckpoint({
  cwd,
  checkpointPath,
  destination,
  branch,
  key,
}) {
  if (fs.existsSync(destination)) throw new Error(`Destino já existe: ${destination}.`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vah-restore-'));
  try {
    const archive = path.join(root, 'payload.tar.gz');
    write(archive, decryptEnvelope(fs.readFileSync(checkpointPath), key));
    const payload = path.join(root, 'payload');
    fs.mkdirSync(payload);
    run('tar', ['-xzf', archive, '-C', payload], root);
    const manifest = verifyPayload(payload);
    if (manifest.bundleSha256) {
      run(
        'git',
        ['fetch', path.join(payload, 'commits.bundle'), `HEAD:refs/heads/${branch}`],
        cwd,
      );
    } else {
      run('git', ['branch', branch, manifest.headSha], cwd);
    }
    run('git', ['worktree', 'add', destination, branch], cwd);
    const staged = path.join(payload, 'staged.patch');
    const unstaged = path.join(payload, 'unstaged.patch');
    if (fs.statSync(staged).size > 0) {
      run('git', ['apply', '--binary', '--index', staged], destination);
    }
    if (fs.statSync(unstaged).size > 0) {
      run('git', ['apply', '--binary', unstaged], destination);
    }
    run('tar', ['-xf', path.join(payload, 'untracked.tar'), '-C', destination], root);
    assertRestoredFiles(destination, manifest.files);
    return { manifest, destination, branch };
  } catch (error) {
    if (fs.existsSync(destination)) {
      run('git', ['worktree', 'remove', '--force', destination], cwd);
    }
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
