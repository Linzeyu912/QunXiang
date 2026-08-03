#!/usr/bin/env node
/**
 * 校验所有 workspace 子包用到的 @novel-agent/* 是否都已声明在 package.json 的 dependencies / peerDependencies。
 *
 * 退出码：
 *   0  全部声明一致
 *   1  存在漏声明 / 多声明 / 解析错误
 *
 * 用途：
 *   pnpm check:workspace-deps
 *   CI（GitHub Actions / 其它）可调用此脚本兜底，避免漏声明 workspace 依赖导致子包在干净机器上启动失败。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WORKSPACE_YAML = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');

const workspaceDirs = WORKSPACE_YAML.split('\n')
  .map((l) => l.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/))
  .filter(Boolean)
  .map((m) => m[1].replace(/\/$/, ''));

// 先收集所有 workspace 子包的实际包名（@novel-agent/xxx）
const workspacePkgNames = new Set();
const dirByName = new Map();
for (const dir of workspaceDirs) {
  const pkgPath = join(ROOT, dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const p = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (p.name?.startsWith('@novel-agent/')) {
    workspacePkgNames.add(p.name);
    dirByName.set(p.name, dir);
  }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"](@novel-agent\/[a-z0-9-]+)(?:\/[^'"]+)?['"]/g;
const DYNAMIC_RE = /import\s*\(\s*['"](@novel-agent\/[a-z0-9-]+)(?:\/[^'"]+)?['"]\s*\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.turbo' || name === 'coverage') continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

let failed = false;
const problems = [];

for (const dir of [...workspaceDirs].sort()) {
  const pkgDir = join(ROOT, dir);
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (!pkg.name?.startsWith('@novel-agent/')) continue;

  const srcDir = join(pkgDir, 'src');
  const files = existsSync(srcDir) ? walk(srcDir) : [];

  const used = new Set();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of [IMPORT_RE, DYNAMIC_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) used.add(m[1]);
    }
  }

  const declaredSet = new Set(
    Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }).filter((d) =>
      d.startsWith('@novel-agent/')
    )
  );

  const missing = [...used].filter((u) => !declaredSet.has(u));
  const notInWorkspace = [...declaredSet].filter((d) => !workspacePkgNames.has(d));

  if (missing.length) {
    failed = true;
    problems.push(
      `[${pkg.name}] 漏声明 workspace 依赖: ${missing.join(', ')}\n` +
        `    import 扫描自 src/，共 ${used.size} 个 @novel-agent/* 引用`
    );
  }
  if (notInWorkspace.length) {
    failed = true;
    problems.push(
      `[${pkg.name}] 声明了非 workspace 的 @novel-agent/* 依赖: ${notInWorkspace.join(', ')}`
    );
  }
}

if (failed) {
  console.error('workspace 依赖检查失败：\n');
  for (const p of problems) console.error('  ' + p + '\n');
  console.error('修复方式：在子包 package.json 的 dependencies 中补齐 "<包名>": "workspace:*"');
  process.exit(1);
}

console.log(`✓ 全部 ${workspacePkgNames.size} 个 workspace 子包的 @novel-agent/* 依赖均已声明。`);
