import { transform } from 'sucrase';
import type {
  AspectRatio,
  DependencyStatus,
  FrameRate,
  RuntimeDiagnostic,
  RuntimeMode,
  SceneFile,
} from '../types/studio';
import {
  detectSceneEntryFile,
  extractBareSpecifiersFromCode,
  extractSceneExternalDependencies,
  getPackageRootName,
  hasCommonJsSyntax,
  hasRealEsmSyntax,
  isImageAssetPath,
  normalizeScenePath,
  parseProjectPackageJson,
  resolveRelativeModulePath,
  scanModuleSpecifiers,
} from '../utils/sceneFiles';
import { bundleWithEsbuildVfs } from './esbuildBrowser';

export interface CompiledSceneBundle {
  runId: string;
  entryPath: string;
  runtimeMode: RuntimeMode;
  html: string;
  dependencies: DependencyStatus[];
  diagnostics: RuntimeDiagnostic[];
  linkedModules?: string[];
  circularDependencies?: string[][];
}

export interface CompileSceneOptions {
  aspectRatio?: AspectRatio;
  frameRate?: FrameRate;
  runId?: string;
  preparedDependencies?: DependencyStatus[];
}

const PINNED_PACKAGE_URLS: Record<string, string> = {
  react: 'https://esm.sh/react@19.1.0',
  'react/jsx-runtime': 'https://esm.sh/react@19.1.0/jsx-runtime',
  'react/jsx-dev-runtime': 'https://esm.sh/react@19.1.0/jsx-dev-runtime',
  'react-dom': 'https://esm.sh/react-dom@19.1.0?deps=react@19.1.0',
  'react-dom/client': 'https://esm.sh/react-dom@19.1.0/client?deps=react@19.1.0',
  gsap: 'https://esm.sh/gsap@3.12.7',
  three: 'https://esm.sh/three@0.170.0',
  animejs: 'https://esm.sh/animejs@3.2.2',
  'lottie-web': 'https://esm.sh/lottie-web@5.12.2',
  motion: 'https://esm.sh/motion@12.23.24?deps=react@19.1.0,react-dom@19.1.0',
  'framer-motion': 'https://esm.sh/framer-motion@12.0.0?deps=react@19.1.0,react-dom@19.1.0',
  'lucide-react': 'https://esm.sh/lucide-react@0.546.0?deps=react@19.1.0',
  'canvas-confetti': 'https://esm.sh/canvas-confetti@1.9.3',
  p5: 'https://esm.sh/p5@1.11.2',
  d3: 'https://esm.sh/d3@7.9.0',
};

const NODE_BUILTIN_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

const SERVER_ONLY_PACKAGES = new Set([
  'express',
  'fastify',
  'koa',
  'hono',
  '@nestjs/core',
  'prisma',
  '@prisma/client',
  'drizzle-orm',
  'mongoose',
  'pg',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'playwright',
  'puppeteer',
  'sharp',
  'nodemon',
  'chokidar',
  'fs-extra',
]);

const REACT_ECOSYSTEM_PREFIXES = [
  '@react-three/',
  '@radix-ui/',
  '@tanstack/react-',
  '@mui/',
  'react-',
  'recharts',
  'zustand',
  'jotai',
  'framer-motion',
  'motion',
  'lucide-react',
];

const VALID_NPM_PACKAGE_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[\w\-./]+)?$/i;

const dependencyVerificationCache = new Map<string, DependencyStatus>();

export function getIncompatibilityReason(specifier: string): string | null {
  const clean = specifier.trim().split('?')[0].split('#')[0];
  if (!clean) return null;

  if (clean.startsWith('node:') || NODE_BUILTIN_MODULES.has(clean) || NODE_BUILTIN_MODULES.has(getPackageRootName(clean))) {
    return `Node.js built-in module "${clean}" requires a server runtime and cannot execute in a browser viewport.`;
  }

  const root = getPackageRootName(clean);
  if (SERVER_ONLY_PACKAGES.has(root)) {
    return `Server/native package "${root}" requires Node.js APIs and is incompatible with the browser viewport.`;
  }

  return null;
}

function cleanSemverHint(range: string | undefined): string | null {
  if (!range) return null;
  const trimmed = range.trim();
  const match = trimmed.match(/^[~^]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match ? match[1] : null;
}

function needsReactDepsQuery(rootName: string): boolean {
  if (rootName === 'react' || rootName === 'react-dom') return false;
  return REACT_ECOSYSTEM_PREFIXES.some((prefix) => rootName.startsWith(prefix));
}

export function resolveExternalPackageUrl(
  specifier: string,
  versionHints: Record<string, string> = {}
): {
  specifier: string;
  rootName: string;
  url: string | null;
  prefixUrl: string | null;
  incompatibilityReason?: string;
} {
  const clean = specifier.trim().split('?')[0].split('#')[0];
  const rootName = getPackageRootName(clean);

  const incompatReason = getIncompatibilityReason(clean);
  if (incompatReason) {
    return {
      specifier: clean,
      rootName,
      url: null,
      prefixUrl: null,
      incompatibilityReason: incompatReason,
    };
  }

  if (PINNED_PACKAGE_URLS[clean]) {
    const pinned = PINNED_PACKAGE_URLS[clean];
    const baseRoot = PINNED_PACKAGE_URLS[rootName] ?? pinned;
    const cleanRootNoQuery = baseRoot.split('?')[0];
    return {
      specifier: clean,
      rootName,
      url: pinned,
      prefixUrl: `${cleanRootNoQuery}/`,
    };
  }

  if (PINNED_PACKAGE_URLS[rootName]) {
    const rootUrl = PINNED_PACKAGE_URLS[rootName];
    const [base, query] = rootUrl.split('?');
    const subpath = clean.slice(rootName.length);
    const fullUrl = query ? `${base}${subpath}?${query}` : `${base}${subpath}`;
    return {
      specifier: clean,
      rootName,
      url: fullUrl,
      prefixUrl: `${base}/`,
    };
  }

  if (!VALID_NPM_PACKAGE_RE.test(clean)) {
    return {
      specifier: clean,
      rootName,
      url: null,
      prefixUrl: null,
      incompatibilityReason: `Unsupported or malformed package specifier "${clean}"`,
    };
  }

  const hintedVer = cleanSemverHint(versionHints[rootName]);
  const subpath = clean.slice(rootName.length);
  const versionedRoot = hintedVer ? `${rootName}@${hintedVer}` : rootName;
  const baseUrl = `https://esm.sh/${versionedRoot}${subpath}`;
  const query = needsReactDepsQuery(rootName) ? '?deps=react@19.1.0,react-dom@19.1.0' : '';

  return {
    specifier: clean,
    rootName,
    url: `${baseUrl}${query}`,
    prefixUrl: `https://esm.sh/${versionedRoot}/`,
  };
}

export async function prepareSceneDependencies(
  files: SceneFile[],
  explicitDeps: string[] = [],
  fetcher: typeof fetch = fetch
): Promise<DependencyStatus[]> {
  const discovered = extractSceneExternalDependencies(files);
  const combined = Array.from(
    new Set([...discovered, ...explicitDeps.map((d) => d.trim()).filter(Boolean)])
  );

  if (combined.length === 0) return [];

  const pkgManifest = parseProjectPackageJson(files);
  const versionHints = pkgManifest?.dependencies ?? {};
  const results: DependencyStatus[] = [];

  await Promise.all(
    combined.map(async (spec) => {
      const resolved = resolveExternalPackageUrl(spec, versionHints);
      if (!resolved.url) {
        results.push({
          name: spec,
          resolvedUrl: '',
          status: 'failed',
          error: resolved.incompatibilityReason ?? `Unsupported or invalid package specifier "${spec}"`,
        });
        return;
      }

      const cached = dependencyVerificationCache.get(resolved.url);
      if (cached && cached.status === 'ready') {
        results.push({ ...cached, name: spec });
        return;
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;

      try {
        const res = await fetcher(resolved.url, {
          method: 'GET',
          signal: controller?.signal,
        });
        if (!res.ok) {
          const failure: DependencyStatus = {
            name: spec,
            resolvedUrl: resolved.url,
            status: 'failed',
            error: `Package "${spec}" could not be loaded (CDN HTTP ${res.status}). Check that it exists on npm and supports browser ESM.`,
          };
          results.push(failure);
          return;
        }

        const ready: DependencyStatus = {
          name: spec,
          resolvedUrl: resolved.url,
          status: 'ready',
        };
        dependencyVerificationCache.set(resolved.url, ready);
        results.push(ready);
      } catch (err) {
        results.push({
          name: spec,
          resolvedUrl: resolved.url,
          status: 'failed',
          error:
            err instanceof Error
              ? `Failed to fetch dependency "${spec}": ${err.message}`
              : `Failed to fetch dependency "${spec}"`,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    })
  );

  const orderMap = new Map(combined.map((name, idx) => [name, idx]));
  results.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
  return results;
}

function makeDiagnostic(
  type: RuntimeDiagnostic['type'],
  message: string,
  source?: string,
  line?: number,
  column?: number,
  severity: 'error' | 'warning' = 'error'
): RuntimeDiagnostic {
  return {
    id: `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    severity,
    message,
    source,
    line,
    column,
    timestamp: new Date().toISOString(),
  };
}

function toJsDataUrl(code: string): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

function toAssetDataUrl(file: SceneFile): string {
  if (isImageAssetPath(file.path) && file.content.startsWith('data:image/')) {
    return file.content;
  }
  if (file.path.toLowerCase().endsWith('.svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
  }
  return `data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`;
}

function inlineCssAssets(
  cssPath: string,
  cssContent: string,
  files: SceneFile[],
  visited: Set<string>,
  diagnostics: RuntimeDiagnostic[],
  inlinedCssPaths: Set<string>
): string {
  if (visited.has(cssPath)) {
    return `/* Circular CSS @import skipped: ${cssPath} */`;
  }
  visited.add(cssPath);
  inlinedCssPaths.add(cssPath);

  // Inline @import "./tokens.css"; or @import "base.css";
  let expanded = cssContent.replace(
    /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*([^;]*);/gi,
    (fullMatch, _quote: string, href: string, mediaQuery: string) => {
      const cleanHref = href.trim();
      if (/^(?:https?:)?\/\//i.test(cleanHref) || cleanHref.startsWith('data:')) {
        return fullMatch;
      }
      const target = resolveRelativeModulePath(cssPath, cleanHref, files, {
        allowBareRelative: true,
      });
      if (!target) {
        diagnostics.push(
          makeDiagnostic(
            'compile-error',
            `CSS @import "${cleanHref}" referenced in ${cssPath} was not found`,
            cssPath
          )
        );
        return `/* Missing @import: ${cleanHref} */`;
      }
      if (/\.(scss|sass|less)$/i.test(target.path)) {
        diagnostics.push(
          makeDiagnostic(
            'compile-error',
            `CSS preprocessor file "${target.path}" cannot execute uncompiled in the browser. Convert to standard .css.`,
            cssPath
          )
        );
        return `/* Unsupported preprocessor @import: ${target.path} */`;
      }
      const nested = inlineCssAssets(
        target.path,
        target.content,
        files,
        visited,
        diagnostics,
        inlinedCssPaths
      );
      const mq = mediaQuery.trim();
      return mq ? `@media ${mq} {\n${nested}\n}` : nested;
    }
  );

  // Resolve local url("./bg.svg") / url("image.png") references
  expanded = expanded.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, _q: string, ref: string) => {
    const cleanRef = ref.trim();
    if (
      !cleanRef ||
      /^(?:https?:)?\/\//i.test(cleanRef) ||
      cleanRef.startsWith('data:') ||
      cleanRef.startsWith('blob:') ||
      cleanRef.startsWith('#')
    ) {
      return full;
    }
    const target = resolveRelativeModulePath(cssPath, cleanRef, files, { allowBareRelative: true });
    if (!target) return full;
    return `url("${toAssetDataUrl(target)}")`;
  });

  visited.delete(cssPath);
  return expanded;
}

function rewriteModuleImports(
  code: string,
  fromPath: string,
  files: SceneFile[],
  onVisitFile: (file: SceneFile) => void,
  onBareSpecifier: (spec: string) => void,
  onEdge?: (from: string, to: string) => void
): { code: string; missingRelative: string[] } {
  const missingRelative: string[] = [];
  const matches = scanModuleSpecifiers(code);

  if (matches.length === 0) {
    return { code, missingRelative };
  }

  let output = code;
  // Apply replacements backwards so indices stay exact
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (match.isTypeOnly) continue;

    const spec = match.specifier.trim();
    if (
      spec.startsWith('http://') ||
      spec.startsWith('https://') ||
      spec.startsWith('data:') ||
      spec.startsWith('blob:') ||
      spec.startsWith('@trenveds/')
    ) {
      continue;
    }

    let replacement = spec;
    const isRelativeOrAlias =
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/') ||
      spec.startsWith('@/') ||
      spec.startsWith('~/');

    if (isRelativeOrAlias) {
      const target = resolveRelativeModulePath(fromPath, spec, files);
      if (!target) {
        missingRelative.push(`${spec} (imported from ${fromPath})`);
        continue;
      }
      onEdge?.(fromPath, target.path);
      onVisitFile(target);
      replacement = `@trenveds/${target.path}`;
    } else {
      onBareSpecifier(spec);
    }

    output =
      output.slice(0, match.specifierStart) + replacement + output.slice(match.specifierEnd);
  }

  return { code: output, missingRelative };
}

function transpileCodeFile(
  file: SceneFile,
  files: SceneFile[],
  diagnostics: RuntimeDiagnostic[],
  inlinedCssPaths: Set<string>
): string {
  const lower = file.path.toLowerCase();

  if (lower.endsWith('.css')) {
    const expandedCss = inlineCssAssets(
      file.path,
      file.content,
      files,
      new Set<string>(),
      diagnostics,
      inlinedCssPaths
    );
    const cssText = JSON.stringify(expandedCss);
    const idLiteral = JSON.stringify(file.path);
    return `
const styleId = ${idLiteral};
const existing = Array.from(document.querySelectorAll('style[data-vfs]')).find((el) => el.getAttribute('data-vfs') === styleId);
if (existing) {
  existing.textContent = ${cssText};
} else {
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-vfs', styleId);
  styleEl.textContent = ${cssText};
  document.head.appendChild(styleEl);
}
export default ${cssText};
`;
  }

  if (/\.(scss|sass|less)$/i.test(lower)) {
    throw new Error(
      `Stylesheet preprocessor "${file.path}" cannot be imported directly in the browser without CSS compilation. Use standard .css instead.`
    );
  }

  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(file.content);
    const namedExports =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.entries(parsed as Record<string, unknown>)
            .filter(([key]) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && key !== 'default')
            .map(([key, val]) => `export const ${key} = ${JSON.stringify(val)};`)
            .join('\n')
        : '';
    return `const _jsonData = ${JSON.stringify(parsed)};\nexport default _jsonData;\n${namedExports}`;
  }

  if (isImageAssetPath(file.path)) {
    return `export default ${JSON.stringify(toAssetDataUrl(file))};`;
  }

  if (
    lower.endsWith('.svg') ||
    lower.endsWith('.glsl') ||
    lower.endsWith('.vert') ||
    lower.endsWith('.frag') ||
    lower.endsWith('.wgsl') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown')
  ) {
    return `export default ${JSON.stringify(file.content)};`;
  }

  const transforms: Array<'typescript' | 'jsx'> = [];
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts') ||
    lower.endsWith('.tsx')
  ) {
    transforms.push('typescript');
  }
  if (lower.endsWith('.jsx') || lower.endsWith('.tsx')) {
    transforms.push('jsx');
  }

  if (transforms.length === 0) {
    return file.content;
  }

  const out = transform(file.content, {
    transforms,
    jsxRuntime: 'automatic',
    production: true,
    filePath: file.path,
  });

  return out.code;
}

export function detectCircularDependencies(edges: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string) => {
    visiting.add(node);
    stack.push(node);

    const neighbors = edges.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        if (visiting.has(next)) {
          const cycleStart = stack.indexOf(next);
          if (cycleStart !== -1) {
            const cycle = [...stack.slice(cycleStart), next];
            const key = cycle.join('->');
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              cycles.push(cycle);
            }
          }
        } else if (!visited.has(next)) {
          dfs(next);
        }
      }
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of edges.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

function buildDiagnosticsBridgeScript(
  runId: string,
  circularDependencies: string[][] = []
): string {
  const safeRunId = JSON.stringify(runId);
  const safeCycles = JSON.stringify(circularDependencies.map((c) => c.join(' -> ')));
  return `<script data-trenveds-bridge="1">
(function () {
  var RUN_ID = ${safeRunId};
  var KNOWN_CYCLES = ${safeCycles};
  var hasError = false;
  var readySent = false;

  function post(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({ channel: 'trenveds-runtime', runId: RUN_ID }, payload), '*');
      }
    } catch (_) {}
  }

  function enrichErrorMessage(msg) {
    var text = String(msg || 'Unknown runtime error');
    if (KNOWN_CYCLES.length > 0 && /before initialization|circular|is not defined|cannot read propert/i.test(text)) {
      return text + ' (Possible circular dependency: ' + KNOWN_CYCLES[0] + ')';
    }
    return text;
  }

  function emitError(type, message, source, line, column) {
    hasError = true;
    post({
      type: type || 'runtime-error',
      message: enrichErrorMessage(message),
      source: source ? String(source) : undefined,
      line: typeof line === 'number' ? line : undefined,
      column: typeof column === 'number' ? column : undefined
    });
  }

  window.__TRENVEDS_REPORT_ERROR__ = function (err, info) {
    var msg = err && err.message ? err.message : String(err || 'React component error');
    emitError('runtime-error', info ? msg + ' ' + info : msg);
  };

  window.addEventListener('error', function (event) {
    if (event && event.target && event.target !== window && !event.message) {
      var tag = event.target.tagName || 'RESOURCE';
      var src = event.target.src || event.target.href || '';
      emitError('runtime-error', 'Failed to load ' + tag + (src ? ' (' + src + ')' : ''), src);
      return;
    }
    emitError(
      'runtime-error',
      event.message || (event.error && event.error.message) || 'Script runtime error',
      event.filename,
      event.lineno,
      event.colno
    );
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var msg = reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection');
    emitError('runtime-error', msg);
  });

  var origError = console.error;
  console.error = function () {
    try {
      var parts = Array.prototype.slice.call(arguments).map(function (arg) {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === 'object' && arg !== null) {
          try { return JSON.stringify(arg); } catch (_) { return String(arg); }
        }
        return String(arg);
      });
      var joined = parts.join(' ').trim();
      if (joined) {
        emitError('console-error', joined);
      }
    } catch (_) {}
    if (typeof origError === 'function') {
      return origError.apply(console, arguments);
    }
  };

  var lockedCanvas = null;
  var lockedCanvasSize = null;
  var lastReportedDimKey = '';
  var dimRafScheduled = false;

  function isNonResponsiveLength(val) {
    if (!val || typeof val !== 'string') return false;
    var trimmed = val.trim().toLowerCase();
    if (
      !trimmed ||
      trimmed === 'auto' ||
      trimmed === 'none' ||
      trimmed === 'initial' ||
      trimmed === 'inherit' ||
      trimmed === 'unset' ||
      trimmed === 'fit-content' ||
      trimmed === 'min-content' ||
      trimmed === 'max-content'
    ) {
      return false;
    }
    if (
      trimmed.indexOf('%') !== -1 ||
      trimmed.indexOf('vw') !== -1 ||
      trimmed.indexOf('vh') !== -1 ||
      trimmed.indexOf('vmin') !== -1 ||
      trimmed.indexOf('vmax') !== -1
    ) {
      return false;
    }
    if (/^[0-9]+(?:\.[0-9]+)?(?:px|pt|cm|mm|in|rem|em)$/i.test(trimmed)) {
      return parseFloat(trimmed) > 0;
    }
    return trimmed.indexOf('var(') !== -1 || trimmed.indexOf('calc(') !== -1;
  }

  function hasResponsiveViewportRule(el) {
    if (!el || el.nodeType !== 1) return false;
    var wExpr = el.style && (el.style.width || el.style.minWidth) ? (el.style.width || el.style.minWidth) : '';
    var hExpr = el.style && (el.style.height || el.style.minHeight) ? (el.style.height || el.style.minHeight) : '';
    try {
      var sheets = document.styleSheets || [];
      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var owner = sheet.ownerNode;
        if (owner && owner.getAttribute && owner.getAttribute('data-trenveds-base') === '1') {
          continue;
        }
        var rules = null;
        try { rules = sheet.cssRules; } catch (_) { rules = null; }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          var rule = rules[r];
          if (rule.type !== 1 || !rule.selectorText) continue;
          try {
            if (el.matches(rule.selectorText) && rule.style) {
              if (rule.style.width || rule.style.minWidth) wExpr = rule.style.width || rule.style.minWidth;
              if (rule.style.height || rule.style.minHeight) hExpr = rule.style.height || rule.style.minHeight;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    var hasRespW = /100%|100vw|100dvw/i.test(wExpr);
    var hasRespH = /100%|100vh|100dvh/i.test(hExpr);
    return hasRespW && hasRespH;
  }

  function getExplicitCssSize(el) {
    if (!el || el.nodeType !== 1) return null;
    var wExpr = el.style && (el.style.width || el.style.minWidth) ? (el.style.width || el.style.minWidth) : '';
    var hExpr = el.style && (el.style.height || el.style.minHeight) ? (el.style.height || el.style.minHeight) : '';
    var arExpr = el.style && el.style.aspectRatio ? el.style.aspectRatio : '';

    var matchedW = '';
    var matchedH = '';
    var matchedAr = '';
    try {
      var sheets = document.styleSheets || [];
      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var owner = sheet.ownerNode;
        if (owner && owner.getAttribute && owner.getAttribute('data-trenveds-base') === '1') {
          continue;
        }
        var rules = null;
        try {
          rules = sheet.cssRules;
        } catch (_) {
          rules = null;
        }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          var rule = rules[r];
          if (rule.type !== 1 || !rule.selectorText) continue;
          try {
            if (el.matches(rule.selectorText) && rule.style) {
              if (rule.style.width || rule.style.minWidth) {
                matchedW = rule.style.width || rule.style.minWidth;
              }
              if (rule.style.height || rule.style.minHeight) {
                matchedH = rule.style.height || rule.style.minHeight;
              }
              if (rule.style.aspectRatio) {
                matchedAr = rule.style.aspectRatio;
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    var finalW = wExpr || matchedW;
    var finalH = hExpr || matchedH;
    var finalAr = arExpr || matchedAr;

    var hasFixedW = isNonResponsiveLength(finalW);
    var hasFixedH = isNonResponsiveLength(finalH);
    var hasAspect = Boolean(finalAr && finalAr.trim() && finalAr.trim() !== 'auto');

    if (!((hasFixedW && hasFixedH) || (hasFixedW && hasAspect) || (hasFixedH && hasAspect))) {
      return null;
    }

    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var w = Math.round(rect && rect.width ? rect.width : el.offsetWidth || 0);
    var h = Math.round(rect && rect.height ? rect.height : el.offsetHeight || 0);
    if (w >= 16 && h >= 16) {
      return { width: w, height: h };
    }
    return null;
  }

  function getSvgIntrinsicSize(svg) {
    if (!svg) return null;
    var explicitCss = getExplicitCssSize(svg);
    if (explicitCss) return explicitCss;

    var wAttr = svg.getAttribute ? svg.getAttribute('width') : null;
    var hAttr = svg.getAttribute ? svg.getAttribute('height') : null;
    if (wAttr && hAttr && wAttr.indexOf('%') === -1 && hAttr.indexOf('%') === -1) {
      var wNum = parseFloat(wAttr);
      var hNum = parseFloat(hAttr);
      if (!isNaN(wNum) && !isNaN(hNum) && wNum >= 16 && hNum >= 16) {
        return { width: Math.round(wNum), height: Math.round(hNum) };
      }
    }

    if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width >= 16 && svg.viewBox.baseVal.height >= 16) {
      return {
        width: Math.round(svg.viewBox.baseVal.width),
        height: Math.round(svg.viewBox.baseVal.height)
      };
    }
    return null;
  }

  function getMeaningfulChildren(parent) {
    if (!parent || !parent.children) return [];
    var out = [];
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      var tag = c.tagName ? c.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
      out.push(c);
    }
    return out;
  }

  function detectSceneDimensions() {
    var docEl = document.documentElement;
    var body = document.body;
    if (!docEl || !body) {
      return { mode: 'fluid', width: 0, height: 0, source: 'none' };
    }

    var bodyChildren = getMeaningfulChildren(body);
    if (bodyChildren.length === 1 && bodyChildren[0].tagName && bodyChildren[0].tagName.toLowerCase() === 'svg') {
      var svgSize = getSvgIntrinsicSize(bodyChildren[0]);
      if (svgSize) {
        return { mode: 'fixed', width: svgSize.width, height: svgSize.height, source: 'svg' };
      }
    }

    var htmlCss = getExplicitCssSize(docEl);
    if (htmlCss) {
      return { mode: 'fixed', width: htmlCss.width, height: htmlCss.height, source: 'html' };
    }

    var bodyCss = getExplicitCssSize(body);
    if (bodyCss) {
      return { mode: 'fixed', width: bodyCss.width, height: bodyCss.height, source: 'body' };
    }

    var userResponsiveBody = hasResponsiveViewportRule(docEl) || hasResponsiveViewportRule(body);
    var vw = window.innerWidth || 0;
    var vh = window.innerHeight || 0;

    var rootEl = document.getElementById('root') || document.getElementById('app');
    var candidates = [];
    var namedNodes = document.querySelectorAll('#scene, #stage, #viewport, .scene, .stage, #root, #app, main');
    for (var i = 0; i < namedNodes.length; i++) {
      candidates.push({ el: namedNodes[i], minSize: 64, source: 'root-container', isNamed: true });
    }
    if (bodyChildren.length === 1) {
      candidates.push({ el: bodyChildren[0], minSize: 64, source: 'body-child', isNamed: false });
    }
    if (rootEl) {
      var rootChildren = getMeaningfulChildren(rootEl);
      if (rootChildren.length === 1) {
        candidates.push({ el: rootChildren[0], minSize: 64, source: 'root-child', isNamed: false });
      }
    }

    var bestContainer = null;
    var bestArea = 0;
    for (var k = 0; k < candidates.length; k++) {
      var item = candidates[k];
      if (!item.el || (item.el.tagName && item.el.tagName.toLowerCase() === 'canvas')) continue;
      var sz = getExplicitCssSize(item.el);
      if (sz && sz.width >= item.minSize && sz.height >= item.minSize) {
        // When user explicitly declared responsive 100vw/100vh on html/body (e.g. centered 900x500 hero card),
        // keep the composition surface unless the inner container actually overflows or is a dedicated scene stage
        if (userResponsiveBody && sz.width <= vw + 2 && sz.height <= vh + 2) {
          continue;
        }
        var area = sz.width * sz.height;
        if (area > bestArea) {
          bestArea = area;
          bestContainer = { width: sz.width, height: sz.height, source: item.source };
        }
      }
    }
    if (bestContainer) {
      return { mode: 'fixed', width: bestContainer.width, height: bestContainer.height, source: bestContainer.source };
    }

    var canvases = document.querySelectorAll('canvas');
    var primaryCanvas = null;
    var primaryCanvasArea = 0;
    for (var c = 0; c < canvases.length; c++) {
      var cv = canvases[c];
      var cw = cv.width || 0;
      var ch = cv.height || 0;
      if (cw * ch > primaryCanvasArea) {
        primaryCanvasArea = cw * ch;
        primaryCanvas = cv;
      }
    }

    if (primaryCanvas) {
      var canvasCss = getExplicitCssSize(primaryCanvas);
      if (canvasCss) {
        return { mode: 'fixed', width: canvasCss.width, height: canvasCss.height, source: 'canvas-css' };
      }

      var hasExplicitAttrs = primaryCanvas.hasAttribute('width') && primaryCanvas.hasAttribute('height');
      var hasCustomBuffer = primaryCanvas.width > 0 && primaryCanvas.height > 0 && (primaryCanvas.width !== 300 || primaryCanvas.height !== 150);

      if (hasExplicitAttrs || hasCustomBuffer) {
        var dpr = window.devicePixelRatio || 1;
        var isLockedSame =
          lockedCanvas === primaryCanvas &&
          lockedCanvasSize &&
          lockedCanvasSize.w === primaryCanvas.width &&
          lockedCanvasSize.h === primaryCanvas.height;

        var isPrebootFixed = window.name === 'tv-fixed';
        var matchesViewport =
          (Math.abs(primaryCanvas.width - vw) <= 3 || Math.abs(primaryCanvas.width / dpr - vw) <= 3) &&
          (Math.abs(primaryCanvas.height - vh) <= 3 || Math.abs(primaryCanvas.height / dpr - vh) <= 3);

        if (isLockedSame || isPrebootFixed || !matchesViewport) {
          lockedCanvas = primaryCanvas;
          lockedCanvasSize = { w: primaryCanvas.width, h: primaryCanvas.height };
          return {
            mode: 'fixed',
            width: primaryCanvas.width,
            height: primaryCanvas.height,
            source: 'canvas'
          };
        }
      }
    }

    // Fallback: if external/unreadable CSS forces explicit large document overflow beyond viewport
    if (docEl.scrollWidth > vw + 12 && docEl.scrollHeight > vh + 12) {
      return {
        mode: 'fixed',
        width: Math.round(docEl.scrollWidth),
        height: Math.round(docEl.scrollHeight),
        source: 'scroll-bounds'
      };
    }

    return { mode: 'fluid', width: 0, height: 0, source: 'fluid' };
  }

  function reportSceneDimensions() {
    try {
      var dim = detectSceneDimensions();
      var key = dim.mode + ':' + dim.width + 'x' + dim.height;
      if (key === lastReportedDimKey) return;
      lastReportedDimKey = key;
      post({
        type: 'scene-dimensions',
        mode: dim.mode,
        width: dim.width,
        height: dim.height,
        source: dim.source
      });
    } catch (_) {}
  }

  function scheduleReportDimensions() {
    if (dimRafScheduled) return;
    dimRafScheduled = true;
    requestAnimationFrame(function () {
      dimRafScheduled = false;
      reportSceneDimensions();
    });
  }

  function installDimensionObservers() {
    reportSceneDimensions();
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      var mo = new MutationObserver(function () {
        scheduleReportDimensions();
      });
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'width', 'height', 'viewBox']
      });
    }
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      var ro = new ResizeObserver(function () {
        scheduleReportDimensions();
      });
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }
  }

  function signalReady() {
    reportSceneDimensions();
    if (readySent || hasError) return;
    requestAnimationFrame(function () {
      reportSceneDimensions();
      requestAnimationFrame(function () {
        reportSceneDimensions();
        if (readySent || hasError) return;
        readySent = true;
        post({ type: 'ready' });
      });
    });
  }

  if (document.readyState === 'complete') {
    installDimensionObservers();
    signalReady();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      installDimensionObservers();
      setTimeout(signalReady, 40);
    }, { once: true });
    window.addEventListener('load', function () {
      reportSceneDimensions();
      signalReady();
    }, { once: true });
  }
})();
</script>`;
}

function buildImportMapScript(importMap: Record<string, string>): string {
  const safeJson = JSON.stringify({ imports: importMap }, null, 2).replace(/<\//g, '<\\/');
  return `<script type="importmap">\n${safeJson}\n</script>`;
}

function buildReactErrorBoundaryBootstrap(entryImportPath: string, entryLabel: string): string {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as EntryMod from '${entryImportPath}';

class TrenvedsRuntimeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    if (typeof window.__TRENVEDS_REPORT_ERROR__ === 'function') {
      window.__TRENVEDS_REPORT_ERROR__(error, info && info.componentStack ? '' : '');
    }
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        'div',
        {
          style: {
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#09090b',
            color: '#fecaca',
            fontFamily: 'system-ui, sans-serif',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              maxWidth: '480px',
              padding: '18px 20px',
              borderRadius: '12px',
              border: '1px solid rgba(239,68,68,0.45)',
              background: 'rgba(127,29,29,0.2)',
            },
          },
          React.createElement('strong', { style: { display: 'block', marginBottom: '6px' } }, 'React Render Error'),
          React.createElement('span', { style: { fontSize: '13px', opacity: 0.9 } }, this.state.error.message || String(this.state.error))
        )
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
const Component = EntryMod.default || EntryMod.App || EntryMod.Scene;
if (!Component) {
  throw new Error('Entry module ${entryLabel} does not export a default, App, or Scene React component.');
}
createRoot(rootEl).render(
  React.createElement(TrenvedsRuntimeErrorBoundary, null, React.createElement(Component))
);
`;
}

export function selectRuntimeMode(files: SceneFile[], entryFile: SceneFile | null): RuntimeMode {
  if (!entryFile) return 'native-html';
  const lower = entryFile.path.toLowerCase();

  if (lower.endsWith('.svg')) return 'svg';

  const hasPackageOrVite = files.some((f) =>
    /^(?:package\.json|tsconfig\.json|vite\.config\.(?:ts|js|mts|mjs))$/i.test(f.path)
  );
  const usesCjs = files.some(
    (f) => /\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(f.path) && hasCommonJsSyntax(f.content)
  );
  const usesAlias = files.some(
    (f) =>
      /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(f.path) &&
      scanModuleSpecifiers(f.content).some((m) => m.specifier.startsWith('@/') || m.specifier.startsWith('~/'))
  );
  const tsJsxCount = files.filter((f) => /\.(ts|mts|cts|tsx|jsx)$/i.test(f.path)).length;

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const scriptMatches = Array.from(
      entryFile.content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
    );
    let usesBundlerTargets = false;
    let usesEsm = false;

    for (const m of scriptMatches) {
      const attrs = m[1] ?? '';
      const inlineBody = m[2] ?? '';
      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      const isModule = /\btype=["']module["']/i.test(attrs);
      const isInlineBabelOrTsx = /\btype=["']text\/(?:babel|jsx|tsx|typescript)["']/i.test(attrs);

      if (srcMatch) {
        const target = resolveRelativeModulePath(entryFile.path, srcMatch[1], files, {
          allowBareRelative: true,
        });
        if (target && /\.(tsx|jsx|ts|mts|cts)$/i.test(target.path)) {
          usesBundlerTargets = true;
        }
        if (target && (isModule || hasRealEsmSyntax(target.content))) {
          usesEsm = true;
        }
      } else if (inlineBody.trim()) {
        if (isInlineBabelOrTsx) usesBundlerTargets = true;
        if (isModule || hasRealEsmSyntax(inlineBody)) usesEsm = true;
      }
    }

    if (usesCjs || usesAlias || (hasPackageOrVite && usesBundlerTargets)) {
      return 'esbuild-bundle';
    }
    if (usesBundlerTargets || tsJsxCount > 0 && usesEsm) {
      return 'sucrase-esm';
    }
    if (usesEsm) {
      return 'native-esm';
    }
    return 'native-html';
  }

  if (usesCjs || usesAlias || hasPackageOrVite || tsJsxCount >= 2) {
    return 'esbuild-bundle';
  }

  if (/\.(ts|mts|cts|jsx|tsx)$/i.test(lower)) {
    return 'sucrase-esm';
  }

  return 'native-esm';
}

function populateImportMapForBareSpecifiers(
  bareSpecifiers: Set<string>,
  importMap: Record<string, string>,
  files: SceneFile[],
  diagnostics: RuntimeDiagnostic[],
  sourceFile: string
) {
  const pkg = parseProjectPackageJson(files);
  const versionHints = pkg?.dependencies ?? {};

  for (const spec of bareSpecifiers) {
    const resolved = resolveExternalPackageUrl(spec, versionHints);
    if (resolved.url) {
      importMap[spec] = resolved.url;
      if (resolved.prefixUrl && !resolved.rootName.startsWith('react')) {
        importMap[`${resolved.rootName}/`] = resolved.prefixUrl;
      }
    } else {
      diagnostics.push(
        makeDiagnostic(
          'dependency-error',
          resolved.incompatibilityReason ?? `Unsupported package specifier "${spec}"`,
          sourceFile
        )
      );
    }
  }
}

export function compileSceneBundle(
  files: SceneFile[],
  options: CompileSceneOptions = {}
): CompiledSceneBundle {
  const runId =
    options.runId ?? `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const entryFile = detectSceneEntryFile(files);

  if (!entryFile) {
    return {
      runId,
      entryPath: '',
      runtimeMode: 'native-html',
      html: '',
      dependencies: [],
      diagnostics: [],
    };
  }

  const runtimeMode = selectRuntimeMode(files, entryFile);
  const diagnostics: RuntimeDiagnostic[] = [];
  const importMap: Record<string, string> = {};
  const bareSpecifiers = new Set<string>();
  const compiledModuleSet = new Set<string>();
  const inlinedCssPaths = new Set<string>();
  const graphEdges = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string) => {
    let set = graphEdges.get(from);
    if (!set) {
      set = new Set<string>();
      graphEdges.set(from, set);
    }
    set.add(to);
  };

  const lowerEntry = entryFile.path.toLowerCase();

  // Reject clearly non-web standalone entries honestly instead of throwing opaque syntax errors
  if (
    /\.(py|md|markdown|txt|csv|yaml|yml|toml|xml)$/i.test(lowerEntry)
  ) {
    return {
      runId,
      entryPath: entryFile.path,
      runtimeMode: 'native-html',
      html: '',
      dependencies: options.preparedDependencies ?? [],
      diagnostics: [
        makeDiagnostic(
          'compile-error',
          `File "${entryFile.path}" is not an executable web scene entrypoint. Add an HTML, JavaScript, TypeScript, React (JSX/TSX), or SVG entry file to run inside the viewport.`,
          entryFile.path
        ),
      ],
    };
  }

  const compileVirtualModule = (file: SceneFile) => {
    if (compiledModuleSet.has(file.path)) return;
    compiledModuleSet.add(file.path);

    if (file.path.toLowerCase().endsWith('.css')) {
      inlinedCssPaths.add(file.path);
    }

    try {
      const transpiled = transpileCodeFile(file, files, diagnostics, inlinedCssPaths);
      const { code: rewritten, missingRelative } = rewriteModuleImports(
        transpiled,
        file.path,
        files,
        compileVirtualModule,
        (bare) => bareSpecifiers.add(bare),
        addEdge
      );

      for (const missing of missingRelative) {
        diagnostics.push(
          makeDiagnostic(
            'compile-error',
            `Unresolved relative import "${missing}"`,
            file.path
          )
        );
      }

      for (const spec of extractBareSpecifiersFromCode(rewritten)) {
        bareSpecifiers.add(spec);
      }

      importMap[`@trenveds/${file.path}`] = toJsDataUrl(rewritten);
    } catch (err) {
      diagnostics.push(
        makeDiagnostic(
          'compile-error',
          err instanceof Error ? err.message : `Failed to compile ${file.path}`,
          file.path
        )
      );
    }
  };

  if (lowerEntry.endsWith('.html') || lowerEntry.endsWith('.htm')) {
    let htmlDoc = entryFile.content;

    // 1. Resolve <link rel="stylesheet" href="..."> (both with and without ./)
    htmlDoc = htmlDoc.replace(
      /<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
      (fullTag, attrs: string) => {
        const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
        if (!hrefMatch) return fullTag;
        const href = hrefMatch[1].trim();
        if (/^(?:https?:)?\/\//i.test(href) || href.startsWith('data:') || href.startsWith('blob:')) {
          return fullTag;
        }
        const target = resolveRelativeModulePath(entryFile.path, href, files, {
          allowBareRelative: true,
        });
        if (!target) {
          diagnostics.push(
            makeDiagnostic(
              'compile-error',
              `Stylesheet href "${href}" referenced in ${entryFile.path} was not found`,
              entryFile.path
            )
          );
          return fullTag;
        }
        if (/\.(scss|sass|less)$/i.test(target.path)) {
          diagnostics.push(
            makeDiagnostic(
              'compile-error',
              `Stylesheet "${target.path}" uses a CSS preprocessor that must be compiled to standard .css.`,
              entryFile.path
            )
          );
          return fullTag;
        }
        const expanded = inlineCssAssets(
          target.path,
          target.content,
          files,
          new Set<string>(),
          diagnostics,
          inlinedCssPaths
        );
        return `<style data-vfs="${target.path}">\n${expanded}\n</style>`;
      }
    );

    // 2. Resolve relative image/media attributes (<img src>, <source src>, <object data>)
    htmlDoc = htmlDoc.replace(
      /(<(?:img|source)\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi,
      (fullTag, prefix: string, quote: string, src: string) => {
        if (/^(?:https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
          return fullTag;
        }
        const target = resolveRelativeModulePath(entryFile.path, src, files, {
          allowBareRelative: true,
        });
        return target ? `${prefix}${quote}${toAssetDataUrl(target)}${quote}` : fullTag;
      }
    );

    // 3. Resolve <script ... src="..."> and inline <script>
    htmlDoc = htmlDoc.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      (fullTag, attrs: string, inlineContent: string) => {
        const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
        const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
        const scriptType = (typeMatch?.[1] ?? '').trim().toLowerCase();
        const isModule = scriptType === 'module';
        const isImportMap = scriptType === 'importmap';

        if (isImportMap || scriptType === 'application/json') {
          return fullTag;
        }

        if (srcMatch) {
          const src = srcMatch[1];
          if (/^(?:https?:)?\/\//i.test(src)) {
            return fullTag;
          }
          const target = resolveRelativeModulePath(entryFile.path, src, files, {
            allowBareRelative: true,
          });
          if (!target) {
            diagnostics.push(
              makeDiagnostic(
                'compile-error',
                `Script src "${src}" referenced in ${entryFile.path} was not found`,
                entryFile.path
              )
            );
            return fullTag;
          }

          const needsModule =
            isModule ||
            /\.(tsx|jsx|ts|mts|cts|mjs)$/i.test(target.path) ||
            hasRealEsmSyntax(target.content);

          if (needsModule) {
            compileVirtualModule(target);
            return `<script type="module" src="${importMap[`@trenveds/${target.path}`] ?? ''}"></script>`;
          }

          return `<script data-vfs="${target.path}">\n${target.content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
        }

        // Inline <script>
        if (!inlineContent.trim()) return fullTag;

        const isInlineBabelOrTsx =
          scriptType === 'text/babel' ||
          scriptType === 'text/jsx' ||
          scriptType === 'text/tsx' ||
          scriptType === 'text/typescript';
        const hasEsm = hasRealEsmSyntax(inlineContent);

        if (isModule || hasEsm || isInlineBabelOrTsx) {
          const syntheticExt =
            scriptType === 'text/tsx'
              ? '.tsx'
              : scriptType === 'text/jsx' || scriptType === 'text/babel'
                ? '.jsx'
                : scriptType === 'text/typescript'
                  ? '.ts'
                  : '.js';
          const syntheticFile: SceneFile = {
            path: `${entryFile.path}.inline${syntheticExt}`,
            content: inlineContent,
            updatedAt: entryFile.updatedAt,
          };
          try {
            const transpiled = transpileCodeFile(syntheticFile, files, diagnostics, inlinedCssPaths);
            const { code: rewritten, missingRelative } = rewriteModuleImports(
              transpiled,
              entryFile.path,
              files,
              compileVirtualModule,
              (bare) => bareSpecifiers.add(bare),
              addEdge
            );
            for (const missing of missingRelative) {
              diagnostics.push(
                makeDiagnostic('compile-error', `Unresolved relative import "${missing}"`, entryFile.path)
              );
            }
            for (const spec of extractBareSpecifiersFromCode(rewritten)) {
              bareSpecifiers.add(spec);
            }
            return `<script type="module" src="${toJsDataUrl(rewritten)}"></script>`;
          } catch (err) {
            diagnostics.push(
              makeDiagnostic(
                'compile-error',
                err instanceof Error ? err.message : `Failed to compile inline script in ${entryFile.path}`,
                entryFile.path
              )
            );
            return fullTag;
          }
        }

        return fullTag;
      }
    );

    populateImportMapForBareSpecifiers(
      bareSpecifiers,
      importMap,
      files,
      diagnostics,
      entryFile.path
    );

    const cycles = detectCircularDependencies(graphEdges);
    const injectedHeadPrelude = [
      buildDiagnosticsBridgeScript(runId, cycles),
      `<style data-trenveds-base="1">:where(html,body){margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;background:#060608;color:#f4f4f5;}</style>`,
      Object.keys(importMap).length > 0 ? buildImportMapScript(importMap) : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (/<head[^>]*>/i.test(htmlDoc)) {
      htmlDoc = htmlDoc.replace(/<head[^>]*>/i, (m) => `${m}\n${injectedHeadPrelude}`);
    } else if (/<html[^>]*>/i.test(htmlDoc)) {
      htmlDoc = htmlDoc.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${injectedHeadPrelude}\n</head>`);
    } else {
      htmlDoc = `<!doctype html><html><head><meta charset="UTF-8" />\n${injectedHeadPrelude}\n</head><body>${htmlDoc}</body></html>`;
    }

    return {
      runId,
      entryPath: entryFile.path,
      runtimeMode: runtimeMode === 'esbuild-bundle' ? 'sucrase-esm' : runtimeMode,
      html: htmlDoc,
      dependencies: options.preparedDependencies ?? [],
      diagnostics,
      linkedModules: Array.from(compiledModuleSet),
      circularDependencies: cycles.length > 0 ? cycles : undefined,
    };
  }

  if (lowerEntry.endsWith('.svg')) {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  ${buildDiagnosticsBridgeScript(runId)}
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #060608; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    svg { max-width: 100%; max-height: 100%; width: 100%; height: 100%; }
  </style>
</head>
<body>${entryFile.content}</body>
</html>`;
    return {
      runId,
      entryPath: entryFile.path,
      runtimeMode: 'svg',
      html,
      dependencies: [],
      diagnostics,
    };
  }

  // JS / TS / JSX / TSX entrypoint
  compileVirtualModule(entryFile);
  const entryModuleKey = `@trenveds/${entryFile.path}`;

  const isReactComponentEntry =
    /\.(jsx|tsx)$/i.test(entryFile.path) &&
    !/createRoot\s*\(|ReactDOM\.render\s*\(/.test(entryFile.content);

  let extraInlineScripts = '';
  if (isReactComponentEntry) {
    bareSpecifiers.add('react');
    bareSpecifiers.add('react/jsx-runtime');
    bareSpecifiers.add('react-dom');
    bareSpecifiers.add('react-dom/client');

    const bootstrapCode = buildReactErrorBoundaryBootstrap(entryModuleKey, entryFile.path);
    const bootstrapKey = '@trenveds/__bootstrap__.js';
    importMap[bootstrapKey] = toJsDataUrl(bootstrapCode);
    extraInlineScripts = `<script type="module" src="${importMap[bootstrapKey]}"></script>`;
  } else {
    extraInlineScripts = `<script type="module" src="${importMap[entryModuleKey] ?? ''}"></script>`;
  }

  const autoCssTags = files
    .filter((f) => f.path.toLowerCase().endsWith('.css') && !inlinedCssPaths.has(f.path))
    .map((f) => {
      const expanded = inlineCssAssets(
        f.path,
        f.content,
        files,
        new Set<string>(),
        diagnostics,
        inlinedCssPaths
      );
      return `<style data-vfs="${f.path}">\n${expanded}\n</style>`;
    })
    .join('\n');

  populateImportMapForBareSpecifiers(
    bareSpecifiers,
    importMap,
    files,
    diagnostics,
    entryFile.path
  );

  const cycles = detectCircularDependencies(graphEdges);
  const headTags = [
    buildDiagnosticsBridgeScript(runId, cycles),
    `<style data-trenveds-base="1">:where(html,body){margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;background:#060608;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;}:where(#root){margin:0;padding:0;min-width:100%;min-height:100%;box-sizing:border-box;}</style>`,
    autoCssTags,
    buildImportMapScript(importMap),
  ]
    .filter(Boolean)
    .join('\n');

  const bodyHtml = `<div id="root"></div>\n${extraInlineScripts}`;

  const finalHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${headTags}
</head>
<body>
  ${bodyHtml}
</body>
</html>`;

  return {
    runId,
    entryPath: normalizeScenePath(entryFile.path),
    runtimeMode: runtimeMode === 'esbuild-bundle' ? 'sucrase-esm' : runtimeMode,
    html: finalHtml,
    dependencies: options.preparedDependencies ?? [],
    diagnostics,
    linkedModules: Array.from(compiledModuleSet),
    circularDependencies: cycles.length > 0 ? cycles : undefined,
  };
}

/**
 * Asynchronous multi-path scene compiler:
 * Uses native HTML/ESM fast-path when appropriate, and activates esbuild-wasm VFS bundling
 * for CommonJS, Vite/package.json projects, @/ aliases, multi-file TS/React apps, or fast-path fallback.
 */
export async function compileSceneBundleAsync(
  files: SceneFile[],
  options: CompileSceneOptions = {}
): Promise<CompiledSceneBundle> {
  const entryFile = detectSceneEntryFile(files);
  const preferredMode = selectRuntimeMode(files, entryFile);

  if (!entryFile || preferredMode === 'native-html' || preferredMode === 'svg') {
    return compileSceneBundle(files, options);
  }

  const fastBundle = compileSceneBundle(files, options);
  const shouldUseEsbuild =
    preferredMode === 'esbuild-bundle' ||
    fastBundle.diagnostics.some(
      (d) => d.type === 'compile-error' && !d.message.includes('was not found')
    );

  if (!shouldUseEsbuild) {
    return fastBundle;
  }

  // Non-HTML JS/TS/JSX/TSX entrypoint -> bundle directly through esbuild-wasm VFS
  const lowerEntry = entryFile.path.toLowerCase();
  if (!lowerEntry.endsWith('.html') && !lowerEntry.endsWith('.htm')) {
    const isReactComponentEntry =
      /\.(jsx|tsx)$/i.test(entryFile.path) &&
      !/createRoot\s*\(|ReactDOM\.render\s*\(/.test(entryFile.content);

    const syntheticEntryCode = isReactComponentEntry
      ? buildReactErrorBoundaryBootstrap(`./${normalizeScenePath(entryFile.path)}`, entryFile.path)
      : undefined;

    const esbuildRes = await bundleWithEsbuildVfs({
      files,
      entryModulePath: entryFile.path,
      syntheticEntryCode,
    });

    if (!esbuildRes.available) {
      return fastBundle;
    }

    const diagnostics: RuntimeDiagnostic[] = [...esbuildRes.diagnostics];
    const importMap: Record<string, string> = {};
    const bareSet = new Set<string>(esbuildRes.externalSpecifiers);
    if (isReactComponentEntry) {
      bareSet.add('react');
      bareSet.add('react/jsx-runtime');
      bareSet.add('react-dom');
      bareSet.add('react-dom/client');
    }

    populateImportMapForBareSpecifiers(bareSet, importMap, files, diagnostics, entryFile.path);

    const inlinedCssPaths = new Set<string>();
    const standaloneCss = files
      .filter((f) => f.path.toLowerCase().endsWith('.css') && !esbuildRes.linkedModules.includes(f.path))
      .map((f) => {
        const expanded = inlineCssAssets(
          f.path,
          f.content,
          files,
          new Set<string>(),
          diagnostics,
          inlinedCssPaths
        );
        return `<style data-vfs="${f.path}">\n${expanded}\n</style>`;
      })
      .join('\n');

    const bundledCssTag = esbuildRes.bundledCss
      ? `<style data-vfs="esbuild-bundle.css">\n${esbuildRes.bundledCss}\n</style>`
      : '';

    const scriptTag = esbuildRes.bundledJs
      ? `<script type="module" src="${toJsDataUrl(esbuildRes.bundledJs)}"></script>`
      : '';

    const runId = fastBundle.runId;
    const headTags = [
      buildDiagnosticsBridgeScript(runId, fastBundle.circularDependencies),
      `<style data-trenveds-base="1">:where(html,body){margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;background:#060608;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;}:where(#root){margin:0;padding:0;min-width:100%;min-height:100%;box-sizing:border-box;}</style>`,
      standaloneCss,
      bundledCssTag,
      Object.keys(importMap).length > 0 ? buildImportMapScript(importMap) : '',
    ]
      .filter(Boolean)
      .join('\n');

    const finalHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${headTags}
</head>
<body>
  <div id="root"></div>
  ${scriptTag}
</body>
</html>`;

    return {
      runId,
      entryPath: normalizeScenePath(entryFile.path),
      runtimeMode: 'esbuild-bundle',
      html: finalHtml,
      dependencies: options.preparedDependencies ?? [],
      diagnostics,
      linkedModules: esbuildRes.linkedModules,
      circularDependencies: fastBundle.circularDependencies,
    };
  }

  // HTML entrypoint referencing a module/TS/TSX/CJS script -> bundle the referenced module script with esbuild-wasm
  const htmlScriptMatch = entryFile.content.match(
    /<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)>[\s\S]*?<\/script>/i
  );
  if (!htmlScriptMatch) {
    return fastBundle;
  }

  const targetScript = resolveRelativeModulePath(entryFile.path, htmlScriptMatch[2], files, {
    allowBareRelative: true,
  });
  if (!targetScript) {
    return fastBundle;
  }

  const esbuildRes = await bundleWithEsbuildVfs({
    files,
    entryModulePath: targetScript.path,
  });

  if (!esbuildRes.available) {
    return fastBundle;
  }

  const diagnostics: RuntimeDiagnostic[] = [...esbuildRes.diagnostics];
  const importMap: Record<string, string> = {};
  const bareSet = new Set<string>(esbuildRes.externalSpecifiers);
  populateImportMapForBareSpecifiers(bareSet, importMap, files, diagnostics, targetScript.path);

  const inlinedCssPaths = new Set<string>();
  let htmlDoc = entryFile.content;
  htmlDoc = htmlDoc.replace(
    /<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
    (fullTag, attrs: string) => {
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (!hrefMatch) return fullTag;
      const href = hrefMatch[1].trim();
      if (/^(?:https?:)?\/\//i.test(href) || href.startsWith('data:') || href.startsWith('blob:')) {
        return fullTag;
      }
      const target = resolveRelativeModulePath(entryFile.path, href, files, { allowBareRelative: true });
      if (!target) {
        diagnostics.push(
          makeDiagnostic(
            'compile-error',
            `Stylesheet href "${href}" referenced in ${entryFile.path} was not found`,
            entryFile.path
          )
        );
        return fullTag;
      }
      const expanded = inlineCssAssets(
        target.path,
        target.content,
        files,
        new Set<string>(),
        diagnostics,
        inlinedCssPaths
      );
      return `<style data-vfs="${target.path}">\n${expanded}\n</style>`;
    }
  );

  htmlDoc = htmlDoc.replace(
    /(<(?:img|source)\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi,
    (fullTag, prefix: string, quote: string, src: string) => {
      if (/^(?:https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
        return fullTag;
      }
      const target = resolveRelativeModulePath(entryFile.path, src, files, {
        allowBareRelative: true,
      });
      return target ? `${prefix}${quote}${toAssetDataUrl(target)}${quote}` : fullTag;
    }
  );

  htmlDoc = htmlDoc.replace(
    /<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)>[\s\S]*?<\/script>/i,
    () =>
      esbuildRes.bundledJs
        ? `<script type="module" src="${toJsDataUrl(esbuildRes.bundledJs)}"></script>`
        : ''
  );

  const runId = fastBundle.runId;
  const injectedHeadPrelude = [
    buildDiagnosticsBridgeScript(runId, fastBundle.circularDependencies),
    `<style data-trenveds-base="1">:where(html,body){margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;background:#060608;color:#f4f4f5;}</style>`,
    esbuildRes.bundledCss ? `<style data-vfs="esbuild-bundle.css">\n${esbuildRes.bundledCss}\n</style>` : '',
    Object.keys(importMap).length > 0 ? buildImportMapScript(importMap) : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (/<head[^>]*>/i.test(htmlDoc)) {
    htmlDoc = htmlDoc.replace(/<head[^>]*>/i, (m) => `${m}\n${injectedHeadPrelude}`);
  } else if (/<html[^>]*>/i.test(htmlDoc)) {
    htmlDoc = htmlDoc.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${injectedHeadPrelude}\n</head>`);
  } else {
    htmlDoc = `<!doctype html><html><head><meta charset="UTF-8" />\n${injectedHeadPrelude}\n</head><body>${htmlDoc}</body></html>`;
  }

  return {
    runId,
    entryPath: entryFile.path,
    runtimeMode: 'esbuild-bundle',
    html: htmlDoc,
    dependencies: options.preparedDependencies ?? [],
    diagnostics,
    linkedModules: esbuildRes.linkedModules,
    circularDependencies: fastBundle.circularDependencies,
  };
}
