#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This executable is intentionally Node CommonJS tooling. */
const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function actualScreens(root) {
  const base = path.join(root, 'src/screens');
  return walk(base)
    .filter((file) => /Screen\.tsx$/.test(file))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
}

function actualRoutes(root) {
  const files = [path.join(root, 'App.tsx'), path.join(root, 'src/navigation/index.tsx')];
  const routes = [];
  const registration = /<(\w+)\.Screen\b([\s\S]*?)\/>/g;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(registration)) {
      const name = match[2].match(/\bname=["']([^"']+)["']/);
      const component = match[2].match(/\bcomponent=\{([A-Za-z_$][\w$]*)\}/);
      if (name && component) routes.push({ navigator: match[1], name: name[1], component: component[1] });
    }
  }
  return routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}

function routeKey(route) {
  return `${route.navigator}:${route.name}:${route.component}`;
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

function verifyManifest(root, manifest) {
  const errors = [];
  const manifestFiles = (manifest.screens || []).map((screen) => screen.file);
  const files = actualScreens(root);
  for (const file of files.filter((item) => !manifestFiles.includes(item))) errors.push(`Missing screen manifest entry: ${file}`);
  for (const file of manifestFiles.filter((item) => !files.includes(item))) errors.push(`Stale screen manifest entry: ${file}`);

  const screenIds = (manifest.screens || []).map((screen) => screen.id);
  for (const id of duplicates(screenIds)) errors.push(`Duplicate screen id: ${id}`);
  for (const file of duplicates(manifestFiles)) errors.push(`Duplicate screen file: ${file}`);

  const actualRouteKeys = actualRoutes(root).map(routeKey);
  const manifestRouteKeys = (manifest.routes || []).map(routeKey);
  for (const key of actualRouteKeys.filter((item) => !manifestRouteKeys.includes(item))) errors.push(`Missing route manifest entry: ${key}`);
  for (const key of manifestRouteKeys.filter((item) => !actualRouteKeys.includes(item))) errors.push(`Stale route manifest entry: ${key}`);
  for (const key of duplicates(manifestRouteKeys)) errors.push(`Duplicate route identity: ${key}`);

  const validStatuses = new Set(['pending', 'review', 'accepted']);
  for (const screen of manifest.screens || []) {
    if (!validStatuses.has(screen.status)) errors.push(`Invalid stale status for ${screen.id}: ${screen.status}`);
    if (screen.status === 'review' && !screen.evidence?.browserReviewed) errors.push(`Review status requires browser review evidence: ${screen.id}`);
    if (screen.status === 'accepted' && !screen.evidence?.iosDeviceAccepted) errors.push(`Accepted status requires iOS device evidence: ${screen.id}`);
    if (screen.evidence?.iosDeviceAccepted && !screen.evidence?.browserReviewed) errors.push(`iOS acceptance requires prior browser review evidence: ${screen.id}`);
  }
  return errors;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const manifestPath = path.join(root, 'src/rebuild/screen-manifest.json');
  const errors = verifyManifest(root, JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Manifest verified against ${actualScreens(root).length} screen files and ${actualRoutes(root).length} route registrations.`);
  }
}

module.exports = { actualRoutes, actualScreens, verifyManifest };
