const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const monorepoNodeModules = path.resolve(monorepoRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// In local monorepo development (pnpm workspace), resolve packages from both
// the project root and the monorepo root.
// On EAS Build, packages are installed in apps/mobile/node_modules only,
// so monorepoNodeModules does not exist — skip it to avoid Metro resolution errors.
if (fs.existsSync(monorepoNodeModules)) {
  config.watchFolders = [monorepoRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    monorepoNodeModules,
  ];
}

module.exports = config;
