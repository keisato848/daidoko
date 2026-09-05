import { access, readdir, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const failures = [];
const passes = [];

// 注意: 下の top-level await より前に置く。関数内から参照する module スコープ const は
// 宣言より先に関数が呼ばれると TDZ で落ちる（2026-09-05 に実際に踏んだ。check-script-tdz は捕まえない）
/** Claude Code の組み込みツール名（frontmatter `tools:` に書けるもの）。増えたらここに足す */
const BUILTIN_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'PowerShell',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Agent',
  'Skill',
  'TodoWrite',
]);
/** `Agent(...)` の許可リストに書ける組み込みエージェント */
const BUILTIN_AGENTS = new Set(['Explore', 'Plan', 'general-purpose', 'claude-code-guide']);

await checkExists('.github/copilot-instructions.md', 'copilot instructions exist');
await validateHookFiles();
await validateSkillFiles();
await validatePromptFiles();
await validateAgentFiles();
await validateGitHooks();
await validateOptionalJson('.vscode/extensions.json');
await validateOptionalJson('.vscode/tasks.json');
await validateClaudeAssets();

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

/** .claude 側の資産（settings.json のフック配線・skills/agents の frontmatter・workflows の構文）を検証する */
async function validateClaudeAssets() {
  // settings.json: パース＋参照スクリプトの実在
  const settingsPath = join(rootDir, '.claude', 'settings.json');
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'));
    passes.push('.claude/settings.json parsed');
    for (const [eventName, matchers] of Object.entries(parsed.hooks ?? {})) {
      for (const matcher of matchers ?? []) {
        for (const hookDef of matcher.hooks ?? []) {
          await validateCommandReference(hookDef.command, settingsPath, eventName);
        }
      }
    }
  } catch (error) {
    failures.push(
      `.claude/settings.json failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // skills: SKILL.md の frontmatter（name=フォルダ名・description 必須）
  const skillsDir = join(rootDir, '.claude', 'skills');
  for (const entry of await safeReadDir(skillsDir)) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      const frontmatter = extractFrontmatter(await readFile(skillPath, 'utf8'));
      if (!frontmatter.name || frontmatter.name !== entry.name) {
        failures.push(
          `${relativePath(skillPath)} frontmatter name must match folder ${entry.name}`,
        );
        continue;
      }
      if (!frontmatter.description) {
        failures.push(`${relativePath(skillPath)} missing frontmatter description`);
        continue;
      }
      passes.push(`${relativePath(skillPath)} parsed`);
    } catch (error) {
      failures.push(
        `${relativePath(skillPath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // agents: frontmatter（name / description 必須）
  const agentsDir = join(rootDir, '.claude', 'agents');
  const agentEntries = (await safeReadDir(agentsDir)).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  );
  const agentNames = new Set(agentEntries.map((entry) => entry.name.replace(/\.md$/, '')));
  for (const entry of agentEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const agentPath = join(agentsDir, entry.name);
    try {
      const frontmatter = extractFrontmatter(await readFile(agentPath, 'utf8'));
      if (!frontmatter.name || !frontmatter.description) {
        failures.push(`${relativePath(agentPath)} missing frontmatter name/description`);
        continue;
      }
      if (frontmatter.name !== entry.name.replace(/\.md$/, '')) {
        failures.push(`${relativePath(agentPath)} frontmatter name must match file name`);
        continue;
      }
      const toolProblems = validateAgentTools(frontmatter.tools, agentNames);
      if (toolProblems.length > 0) {
        failures.push(`${relativePath(agentPath)} tools: ${toolProblems.join('; ')}`);
        continue;
      }
      passes.push(`${relativePath(agentPath)} parsed`);
    } catch (error) {
      failures.push(
        `${relativePath(agentPath)} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // workflows: meta エクスポートを含む JS として構文チェック（node --check）
  const workflowsDir = join(rootDir, '.claude', 'workflows');
  for (const entry of await safeReadDir(workflowsDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const wfPath = join(workflowsDir, entry.name);
    try {
      const raw = await readFile(wfPath, 'utf8');
      if (!/export\s+const\s+meta\s*=/.test(raw)) {
        failures.push(`${relativePath(wfPath)} must export const meta`);
        continue;
      }
      passes.push(`${relativePath(wfPath)} has meta export`);
    } catch (error) {
      failures.push(
        `${relativePath(wfPath)} failed to read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
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
  await checkExists(
    scriptPath,
    `${relativePath(sourceFilePath)} event ${eventName} references ${scriptPath}`,
  );
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

/**
 * frontmatter `tools:` を検証する。
 * - 各項目は組み込みツール名か `mcp__` 接頭辞
 * - `Agent(a, b)` の各名は `.claude/agents/<name>.md` として実在するか組み込みエージェント
 * 束ねる役の許可リストが改名で静かに断線するのを止める（2026-09-05 の 7 軸監査で指摘）。
 * @param {string | undefined} tools
 * @param {Set<string>} agentNames
 * @returns {string[]} 問題の一覧（空なら OK）
 */
function validateAgentTools(tools, agentNames) {
  if (!tools) return [];
  const problems = [];
  // `Agent(a, b)` を先に取り出してからカンマで割る（括弧内のカンマを守る）
  const rest = tools.replace(/Agent\(([^)]*)\)/g, (_match, inner) => {
    for (const name of inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!agentNames.has(name) && !BUILTIN_AGENTS.has(name)) {
        problems.push(`Agent(${name}) は .claude/agents に無い`);
      }
    }
    return 'Agent';
  });
  for (const item of rest
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (item.startsWith('mcp__')) continue;
    if (item === '*') continue;
    if (!BUILTIN_TOOLS.has(item)) problems.push(`未知のツール名 ${item}`);
  }
  return problems;
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
  return filePath
    .replace(`${rootDir}${basename(rootDir).startsWith('\\') ? '' : '\\'}`, '')
    .replaceAll('\\', '/');
}
