import { execFileSync } from 'node:child_process';

// Adaptador Quave One para o `audit`. Caminho primário: a CLI oficial
// (`quaveone env status --env <nome> --output json`), que funciona com user
// token OU env token e não dispara deploy. Somente leitura. Nunca imprime o
// token; erros trazem só stderr resumido.

function normalize(json) {
  // Aceita tanto a forma da Status API quanto a da CLI; procura os campos
  // comuns de forma defensiva.
  const dep = json.currentDeployment || json.deployment || {};
  return {
    available: true,
    version: json.currentVersion ?? json.version ?? dep.version ?? null,
    contentId: json.currentContentId ?? dep.contentId ?? json.contentId ?? null,
    gitCommitId:
      dep.gitCommitId ?? json.gitCommitId ?? json.commit ?? null,
    deploymentStatus: dep.status ?? json.deploymentStatus ?? null,
    activityStatus: json.activityStatus ?? json.status ?? null,
  };
}

export function collectQuave({ config, env = process.env }) {
  const q = config?.audit?.quave || {};
  const envName = env[q.envNameEnv || 'QUAVEONE_ENV_NAME'];
  const envToken = env[q.envTokenEnv || 'QUAVEONE_ENV_TOKEN'];
  const cli = env[q.cliEnv || 'QUAVEONE_CLI'] || 'quaveone';

  if (!envName) {
    return { available: false, reason: 'QUAVEONE_ENV_NAME ausente' };
  }
  if (!envToken && !env.QUAVEONE_USER_TOKEN) {
    return { available: false, reason: 'sem token da Quave One (env ou user)' };
  }

  try {
    const out = execFileSync(
      cli,
      ['env', 'status', '--env', envName, '--output', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        // process.env garante PATH/HOME; `env` (defaults a process.env) e os
        // overrides de token vêm por cima.
        env: {
          ...process.env,
          ...env,
          QUAVEONE_ENV_TOKEN: envToken || '',
          QUAVEONE_ENV_NAME: envName,
        },
      },
    );
    const json = JSON.parse(out);
    return normalize(json);
  } catch (error) {
    const stderr = String(error.stderr || error.message || '')
      .split('\n')
      .slice(0, 2)
      .join(' ')
      .slice(0, 200);
    return { available: false, reason: `CLI quave falhou: ${stderr}` };
  }
}
