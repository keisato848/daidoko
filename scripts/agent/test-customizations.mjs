import { access, readdir, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const failures = [];
const passes = [];

await checkExists('.github/copilot-instructions.md', 'copilot instructions exist');
await validateHookFiles();
await validateSkillFiles();
await validatePromptFiles();
await validateAgentFiles();
await validateGitHooks();
await validateOptionalJson('.vscode/extensions.json');
await validateOptionalJson('.vscode/tasks.json');

if (failures.length === 0) {
  console.log(`Customization smoke test: OK (${passes.length} checks)`);
  for (const message of passes) {
    console.log(`[OK] ${message}`);
  }
  process.exit(0);
}

console.error(`Customization smoke test: FAILED (${failures.length} issues)`);
for (const message of passes) {
  console.log(`[OK] ${message}`);
}
for (const message of failures) {
  console.error(`[NG] ${message}`);
}
process.exit(1);

async function validateHookFiles() {
  const dirPath = join(rootDir, '.github', 'hooks');
  const entries = await safeReadDir(dirPath);
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));

  if (jsonFiles.length === 0) {
    failures.push('.github/hooks has no JSON hook definitions');
    return;
  }

  for (const entry of jsonFiles) {
    const filePath = join(dirPath, entry.name);
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (!parsed.hooks || typeof parsed.hooks !== 'object') {
        failures.push(`${relativePath(filePath)} must contain a hooks object`);
        continue;
      }
      passes.push(`${relativePath(filePath)} parsed`);
      for (const [eventName, commands] of Object.entries(parsed.hooks)) {
        if (!Array.isArray(commands) || commands.length === 0) {
          failures.push(`${relativePath(filePath)} event ${eventName} must contain commands`);
          continue;
        }
        for (const commandDef of commands) {
          if (commandDef.type !== 'command') {
            failures.push(`${relativePath(filePath)} event ${eventName} must use type=command`);
            continue;
          }
          await validateCommandReference(commandDef.command, filePath, eventName);
        }
      }
    } catch (error) {
      failures.push(
        `${relativePath(filePath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function validateSkillFiles() {
  const dirPath = join(rootDir, '.github', 'skills');
  const entries = await safeReadDir(dirPath);
  const directories = entries.filter((entry) => entry.isDirectory());

  for (const entry of directories) {
    const skillPath = join(dirPath, entry.name, 'SKILL.md');
    try {
      const raw = await readFile(skillPath, 'utf8');
      const frontmatter = extractFrontmatter(raw);
      if (!frontmatter.name) {
        failures.push(`${relativePath(skillPath)} missing frontmatter name`);
        continue;
      }
      if (frontmatter.name !== entry.name) {
        failures.push(`${relativePath(skillPath)} name must match folder ${entry.name}`);
      }
      if (!frontmatter.description) {
        failures.push(`${relativePath(skillPath)} missing frontmatter description`);
      }
      validateMarkdownLinks(skillPath, raw);
      passes.push(`${relativePath(skillPath)} parsed`);
    } catch (error) {
      failures.push(
        `${relativePath(skillPath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function validateAgentFiles() {
  const dirPath = join(rootDir, '.github', 'agents');
  const entries = await safeReadDir(dirPath);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.agent.md'));

  for (const entry of files) {
    const filePath = join(dirPath, entry.name);
    try {
      const raw = await readFile(filePath, 'utf8');
      const frontmatter = extractFrontmatter(raw);
      if (!frontmatter.description) {
        failures.push(`${relativePath(filePath)} missing frontmatter description`);
        continue;
      }
      validateMarkdownLinks(filePath, raw);
      passes.push(`${relativePath(filePath)} parsed`);
    } catch (error) {
      failures.push(
        `${relativePath(filePath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function validatePromptFiles() {
  const dirPath = join(rootDir, '.github', 'prompts');
  const entries = await safeReadDir(dirPath);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.prompt.md'));

  for (const entry of files) {
    const filePath = join(dirPath, entry.name);
    try {
      const raw = await readFile(filePath, 'utf8');
      const frontmatter = extractFrontmatter(raw);
      if (!frontmatter.description) {
        failures.push(`${relativePath(filePath)} missing frontmatter description`);
        continue;
      }
      validateMarkdownLinks(filePath, raw);
      passes.push(`${relativePath(filePath)} parsed`);
    } catch (error) {
      failures.push(
        `${relativePath(filePath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function validateGitHooks() {
  await checkExists('.githooks/pre-commit', 'pre-commit hook exists');
  await checkExists('.githooks/pre-push', 'pre-push hook exists');
}

async function validateOptionalJson(relativeTargetPath) {
  const fullPath = join(rootDir, relativeTargetPath);
  try {
    await access(fullPath, fsConstants.F_OK);
  } catch {
    return;
  }

  try {
    JSON.parse(await readFile(fullPath, 'utf8'));
    passes.push(`${relativeTargetPath} parsed`);
  } catch (error) {
    failures.push(
      `${relativeTargetPath} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validateCommandReference(commandText, sourceFilePath, eventName) {
  if (!commandText || typeof commandText !== 'string') {
    failures.push(`${relativePath(sourceFilePath)} event ${eventName} missing command string`);
    return;
  }

  const match = commandText.match(/^node\s+([^\s]+\.m?js)\b/);
  if (!match) {
    return;
  }

  const scriptPath = match[1];
  await checkExists(scriptPath, `${relativePath(sourceFilePath)} event ${eventName} references ${scriptPath}`);
}

async function checkExists(relativeTargetPath, successMessage) {
  const fullPath = join(rootDir, relativeTargetPath);
  try {
    await access(fullPath, fsConstants.F_OK);
    if (successMessage) {
      passes.push(successMessage);
    }
  } catch {
    failures.push(`${relativeTargetPath} does not exist`);
  }
}

function extractFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('missing YAML frontmatter');
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
  );
}

function validateMarkdownLinks(filePath, raw) {
  const linkPattern = /\[[^\]]+\]\((\.\/[^)]+)\)/g;
  let match = null;
  while ((match = linkPattern.exec(raw)) !== null) {
    const target = resolve(join(filePath, '..', match[1]));
    if (!target.startsWith(rootDir)) {
      failures.push(`${relativePath(filePath)} links outside workspace: ${match[1]}`);
    }
  }
}

async function safeReadDir(dirPath) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function relativePath(filePath) {
  return filePath.replace(`${rootDir}${basename(rootDir).startsWith('\\') ? '' : '\\'}`, '').replaceAll('\\', '/');
}