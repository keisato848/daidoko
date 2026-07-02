function parseArgs(argv) {
  const parsed = { name: '', surfaces: ['mobile', 'server', 'shared', 'docs'], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--name' && argv[index + 1]) {
      parsed.name = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--surfaces' && argv[index + 1]) {
      parsed.surfaces = argv[index + 1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (token === '--json') {
      parsed.json = true;
    }
  }
  return parsed;
}

const options = parseArgs(process.argv.slice(2));
if (!options.name) {
  console.error('Usage: node scripts/agent/scaffold-feature-plan.mjs --name <feature-name> [--surfaces mobile,server,shared,docs] [--json]');
  process.exit(1);
}

const slug = options.name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const pascal = slug
  .split('-')
  .filter(Boolean)
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join('');

const files = [];

if (options.surfaces.includes('mobile')) {
  files.push(
    `apps/mobile/src/features/${slug}/${slug}.screen.tsx`,
    `apps/mobile/src/features/${slug}/${slug}.service.ts`,
    `apps/mobile/src/features/${slug}/__tests__/${slug}.test.ts`,
  );
}

if (options.surfaces.includes('server')) {
  files.push(
    `apps/server/src/routes/${slug}.ts`,
    `apps/server/src/services/${slug}.service.ts`,
    `apps/server/src/services/__tests__/${slug}.service.test.ts`,
  );
}

if (options.surfaces.includes('shared')) {
  files.push(
    `packages/shared/src/${slug}.ts`,
    `packages/shared/src/__tests__/${slug}.test.ts`,
  );
}

if (options.surfaces.includes('docs')) {
  files.push(`docs/${slug}.md`);
}

const summary = {
  featureName: options.name,
  slug,
  pascalName: pascal,
  surfaces: options.surfaces,
  files,
  checklist: [
    'Confirm the owning doc surface before coding.',
    'Add validation commands to the changed-slice flow.',
    'Update tests for each touched surface.',
    'Update docs when behavior or workflow changes.',
  ],
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

console.log(`Scaffold plan for ${options.name}`);
console.log(`Slug: ${summary.slug}`);
console.log(`PascalName: ${summary.pascalName}`);
console.log('Files:');
for (const file of summary.files) {
  console.log(`- ${file}`);
}
console.log('Checklist:');
for (const item of summary.checklist) {
  console.log(`- ${item}`);
}