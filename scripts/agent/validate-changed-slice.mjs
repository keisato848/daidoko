import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pnpmBinary, runCommand, tail, toPosixPath, unique } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const files = unique(
  (options.files.length > 0 ? options.files : resolveFilesFromGit(options))
    .map(toPosixPath)
    .filter(Boolean),
);

if (files.length === 0) {
  output({ ok: true, files, tasks: [], recommendations: [] });
  process.exit(0);
}

const plan = buildValidationPlan(files);
const tasks = options.dryRun ? plan.tasks : plan.tasks.map(executeTask);
const summary = {
  ok: tasks.every((task) => task.ok !== false),
  files,
  tasks,
  recommendations: plan.recommendations,
};

output(summary);
process.exit(summary.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    files: [],
    json: false,
    dryRun: false,
    staged: false,
    range: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (token === '--staged') {
      parsed.staged = true;
      continue;
    }
    if (token === '--range') {
      parsed.range = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token === '--files') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        parsed.files.push(argv[index + 1]);
        index += 1;
      }
    }
  }

  return parsed;
}

function resolveFilesFromGit(parsed) {
  if (parsed.staged) {
    return gitDiff(['--cached']);
  }
  if (parsed.range) {
    const ranged = gitDiff([parsed.range]);
    if (ranged.length > 0) {
      return ranged;
    }
    if (parsed.range === '@{upstream}...HEAD') {
      return gitDiff(['HEAD~1...HEAD']);
    }
  }
  return gitDiff(['HEAD']);
}

function gitDiff(extraArgs) {
  const result = runCommand('git', ['diff', '--name-only', '--relative', ...extraArgs], {
    cwd: rootDir,
  });

  if (!result.ok) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildValidationPlan(files) {
  const taskMap = new Map();
  const recommendations = [];
  const docsFiles = files.filter(isDocsLikeFile);
  const customizationChanged = files.some(isCustomizationFile);
  const rootConfigChanged = files.some(isRootConfigFile);
  const sharedChanged = files.some((file) => file.startsWith('packages/shared/'));
  const serverChanged = files.some((file) => file.startsWith('apps/server/'));
  const mobileChanged = files.some((file) => file.startsWith('apps/mobile/'));
  const androidChanged = files.some(
    (file) => file.startsWith('apps/mobile/android/') || file.startsWith('e2e/'),
  );
  const photoOrOcrChanged = files.some(
    (file) => /photo|ocr/i.test(file) && (file.startsWith('apps/mobile/') || file.startsWith('e2e/')),
  );

  if (docsFiles.length > 0) {
    addTask(
      'docs-prettier',
      'Prettier check for changed docs and markdown',
      pnpmBinary(),
      ['exec', 'prettier', '--check', ...docsFiles],
      'Keep documentation and prompts format-clean.',
      taskMap,
    );
  }

  if (customizationChanged || rootConfigChanged) {
    addTask(
      'customizations-test',
      'Customization smoke test',
      process.execPath,
      ['scripts/agent/test-customizations.mjs'],
      'Hooks, skills, git hooks, and instructions must parse.',
      taskMap,
    );
  }

  if (rootConfigChanged) {
    addTask(
      'agent-preflight',
      'Agent environment preflight',
      process.execPath,
      ['scripts/agent/preflight.mjs', '--json'],
      'Root config changes can invalidate environment assumptions.',
      taskMap,
    );
  }

  if (sharedChanged) {
    addWorkspaceTask('shared-lint', '@daidoko/shared lint', ['--filter', '@daidoko/shared', 'lint'], taskMap);
    addWorkspaceTask(
      'shared-typecheck',
      '@daidoko/shared typecheck',
      ['--filter', '@daidoko/shared', 'typecheck'],
      taskMap,
    );
    addWorkspaceTask('shared-test', '@daidoko/shared test', ['--filter', '@daidoko/shared', 'test'], taskMap);
    addWorkspaceTask('mobile-typecheck', 'mobile typecheck', ['--filter', 'mobile', 'typecheck'], taskMap);
    addWorkspaceTask('server-typecheck', 'server typecheck', ['--filter', 'server', 'typecheck'], taskMap);
  }

  if (serverChanged) {
    addWorkspaceTask('server-lint', 'server lint', ['--filter', 'server', 'lint'], taskMap);
    addWorkspaceTask('server-typecheck', 'server typecheck', ['--filter', 'server', 'typecheck'], taskMap);
    if (files.some((file) => file.startsWith('apps/server/src/'))) {
      addWorkspaceTask('server-test', 'server test', ['--filter', 'server', 'test'], taskMap);
    }
  }

  if (mobileChanged) {
    addWorkspaceTask('mobile-lint', 'mobile lint', ['--filter', 'mobile', 'lint'], taskMap);
    addWorkspaceTask('mobile-typecheck', 'mobile typecheck', ['--filter', 'mobile', 'typecheck'], taskMap);
    if (shouldRunMobileTests(files)) {
      addWorkspaceTask('mobile-test', 'mobile test', ['--filter', 'mobile', 'test'], taskMap);
    }
  }

  if (androidChanged) {
    recommendations.push('Consider pnpm agent:android:e2e:base after code validation passes.');
  }

  if (photoOrOcrChanged) {
    recommendations.push('Consider pnpm agent:android:e2e:ocr and pnpm agent:android:e2e:photo for OCR/photo flows.');
  }

  return {
    tasks: [...taskMap.values()],
    recommendations,
  };
}

function executeTask(task) {
  const startedAt = Date.now();
  const result = runCommand(task.command, task.args, { cwd: rootDir, env: task.env });
  return {
    ...task,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    status: result.status,
    output: tail(result.combinedOutput, 20),
  };
}

function addWorkspaceTask(id, label, pnpmArgs, taskMap) {
  addTask(id, label, pnpmBinary(), pnpmArgs, label, taskMap);
}

function addTask(id, label, command, args, reason, taskMap, env = undefined) {
  if (taskMap.has(id)) {
    return;
  }
  taskMap.set(id, { id, label, command, args, reason, env });
}

function shouldRunMobileTests(files) {
  return files.some(
    (file) =>
      file.startsWith('apps/mobile/app/') ||
      file.includes('/__tests__/') ||
      file.startsWith('apps/mobile/src/agents/') ||
      file.startsWith('apps/mobile/src/components/') ||
      file.startsWith('apps/mobile/src/services/'),
  );
}

function isCustomizationFile(file) {
  return (
    file.startsWith('.github/') ||
    file.startsWith('.githooks/') ||
    file.startsWith('scripts/agent/') ||
    isRootConfigFile(file)
  );
}

function isRootConfigFile(file) {
  return [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    '.prettierrc',
    'eslint.config.js',
  ].includes(file);
}

function isDocsLikeFile(file) {
  return (
    file.startsWith('docs/') ||
    file.startsWith('mockup/') ||
    file.endsWith('.md') ||
    file.endsWith('.json') ||
    file.endsWith('.yml') ||
    file.endsWith('.yaml')
  );
}

function output(summary) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  console.log(`Changed-slice validation: ${summary.ok ? 'OK' : 'FAILED'}`);
  console.log(`Files: ${summary.files.join(', ')}`);
  for (const task of summary.tasks) {
    const planned = task.ok === undefined;
    const marker = planned ? '[PLAN]' : task.ok ? '[OK]' : '[NG]';
    console.log(`${marker} ${task.label}`);
    if (task.output) {
      console.log(task.output);
    }
  }
  for (const recommendation of summary.recommendations) {
    console.log(`[NEXT] ${recommendation}`);
  }
}