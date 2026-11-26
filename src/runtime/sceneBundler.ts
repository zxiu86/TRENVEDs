import { transform } from 'sucrase';
import type {
  AspectRatio,
  DependencyStatus,
  FrameRate,
  RuntimeDiagnostic,
  SceneFile,
} from '../types/studio';
import {
  detectSceneEntryFile,
  extractBareSpecifiersFromCode,
  extractSceneExternalDependencies,
  getPackageRootName,
  normalizeScenePath,
  resolveRelativeModulePath,
} from '../utils/sceneFiles';

export interface CompiledSceneBundle {
  runId: string;
  entryPath: string;
  html: string;
  dependencies: DependencyStatus[];
  diagnostics: RuntimeDiagnostic[];
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

const VALID_NPM_PACKAGE_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[\w\-./]+)?$/i;

const dependencyVerificationCache = new Map<string, DependencyStatus>();

export function resolveExternalPackageUrl(specifier: string): {
  specifier: string;
  rootName: string;
  url: string | null;
  prefixUrl: string | null;
} {
  const clean = specifier.trim().split('?')[0].split('#')[0];
  const rootName = getPackageRootName(clean);

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
    };
  }

  return {
    specifier: clean,
    rootName,
    url: `https://esm.sh/${clean}`,
    prefixUrl: `https://esm.sh/${rootName}/`,
  };
}

export async function prepareSceneDependencies(
  files: SceneFile[],
  explicitDeps: string[] = [],
  fetcher: typeof fetch = fetch
): Promise<DependencyStatus[]> {
  const discovered = extractSceneExternalDependencies(files);
  const combined = Array.from(new Set([...discovered, ...explicitDeps.map((d) => d.trim()).filter(Boolean)]));

  if (combined.length === 0) return [];

  const results: DependencyStatus[] = [];

  await Promise.all(
    combined.map(async (spec) => {
      const resolved = resolveExternalPackageUrl(spec);
      if (!resolved.url) {
        results.push({
          name: spec,
          resolvedUrl: '',
          status: 'failed',
          error: `Unsupported or invalid package specifier "${spec}"`,
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
            error: `CDN returned HTTP ${res.status} for ${spec}`,
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

  // Preserve deterministic order
  const orderMap = new Map(combined.map((name, idx) => [name, idx]));
  results.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
  return results;
}

function makeDiagnostic(
  type: RuntimeDiagnostic['type'],
  message: string,
  source?: string,
  line?: number,
  column?: number
): RuntimeDiagnostic {
  return {
    id: `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
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

function rewriteModuleImports(
  code: string,
  fromPath: string,
  files: SceneFile[],
  onVisitFile: (file: SceneFile) => void,
  onBareSpecifier: (spec: string) => void
): { code: string; missingRelative: string[] } {
  const missingRelative: string[] = [];

  const replaceSpec = (rawSpec: string): string => {
    const spec = rawSpec.trim();
    if (
      spec.startsWith('http://') ||
      spec.startsWith('https://') ||
      spec.startsWith('data:') ||
      spec.startsWith('blob:')
    ) {
      return rawSpec;
    }

    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
      const target = resolveRelativeModulePath(fromPath, spec, files);
      if (!target) {
        missingRelative.push(`${spec} (imported from ${fromPath})`);
        return rawSpec;
      }
      onVisitFile(target);
      return `@trenveds/${target.path}`;
    }

    if (spec.startsWith('@trenveds/')) {
      return rawSpec;
    }

    onBareSpecifier(spec);
    return spec;
  };

  // Rewrite static import/export statements (bindings + side-effect imports) & dynamic imports
  const rewritten = code
    .replace(
      /(\b(?:import|export)\s+(?:type\s+)?(?:[\w*$]+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\}|\*\s+as\s+[\w$]+)\s+from\s*)(['"])([^'"]+)\2/g,
      (_full, prefix: string, quote: string, spec: string) =>
        `${prefix}${quote}${replaceSpec(spec)}${quote}`
    )
    .replace(
      /(\bimport\s*)(['"])([^'"]+)\2/g,
      (_full, prefix: string, quote: string, spec: string) =>
        `${prefix}${quote}${replaceSpec(spec)}${quote}`
    )
    .replace(
      /(import\s*\(\s*)(['"])([^'"]+)\2(\s*\))/g,
      (_full, prefix: string, quote: string, spec: string, suffix: string) =>
        `${prefix}${quote}${replaceSpec(spec)}${quote}${suffix}`
    );

  return { code: rewritten, missingRelative };
}

function transpileCodeFile(file: SceneFile): string {
  const lower = file.path.toLowerCase();

  if (lower.endsWith('.css')) {
    const cssText = JSON.stringify(file.content);
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

  if (lower.endsWith('.json')) {
    // Validate JSON strictly during compilation
    const parsed = JSON.parse(file.content);
    return `export default ${JSON.stringify(parsed)};`;
  }

  if (lower.endsWith('.svg')) {
    return `export default ${JSON.stringify(file.content)};`;
  }

  const transforms: Array<'typescript' | 'jsx'> = [];
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.tsx')) {
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

function buildDiagnosticsBridgeScript(runId: string): string {
  const safeRunId = JSON.stringify(runId);
  return `<script data-trenveds-bridge="1">
(function () {
  var RUN_ID = ${safeRunId};
  var hasError = false;
  var readySent = false;

  function post(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({ channel: 'trenveds-runtime', runId: RUN_ID }, payload), '*');
      }
    } catch (_) {}
  }

  function emitError(type, message, source, line, column) {
    hasError = true;
    post({
      type: type || 'runtime-error',
      message: String(message || 'Unknown runtime error'),
      source: source ? String(source) : undefined,
      line: typeof line === 'number' ? line : undefined,
      column: typeof column === 'number' ? column : undefined
    });
  }

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

  function signalReady() {
    if (readySent || hasError) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (readySent || hasError) return;
        readySent = true;
        post({ type: 'ready' });
      });
    });
  }

  if (document.readyState === 'complete') {
    signalReady();
  } else {
    window.addEventListener('load', signalReady, { once: true });
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(signalReady, 40);
    }, { once: true });
  }
})();
</script>`;
}

function buildImportMapScript(importMap: Record<string, string>): string {
  const safeJson = JSON.stringify({ imports: importMap }, null, 2).replace(/<\//g, '<\\/');
  return `<script type="importmap">\n${safeJson}\n</script>`;
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
      html: '',
      dependencies: [],
      diagnostics: [],
    };
  }

  const diagnostics: RuntimeDiagnostic[] = [];
  const importMap: Record<string, string> = {};
  const bareSpecifiers = new Set<string>();
  const compiledModuleSet = new Set<string>();
  const inlinedCssPaths = new Set<string>();

  const compileVirtualModule = (file: SceneFile) => {
    if (compiledModuleSet.has(file.path)) return;
    compiledModuleSet.add(file.path);

    if (file.path.toLowerCase().endsWith('.css')) {
      inlinedCssPaths.add(file.path);
    }

    try {
      const transpiled = transpileCodeFile(file);
      const { code: rewritten, missingRelative } = rewriteModuleImports(
        transpiled,
        file.path,
        files,
        compileVirtualModule,
        (bare) => bareSpecifiers.add(bare)
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

      // Add explicit React runtime specifiers if sucrase injected jsx-runtime imports
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

  let bodyHtml = '';
  let headTags = '';
  let entryModuleKey: string | null = null;
  let extraInlineScripts = '';

  const lowerEntry = entryFile.path.toLowerCase();

  if (lowerEntry.endsWith('.html') || lowerEntry.endsWith('.htm')) {
    let htmlDoc = entryFile.content;

    // Resolve <link rel="stylesheet" href="..."> referencing VFS CSS files
    htmlDoc = htmlDoc.replace(
      /<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
      (fullTag, attrs: string) => {
        const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
        if (!hrefMatch) return fullTag;
        const target = resolveRelativeModulePath(entryFile.path, hrefMatch[1], files);
        if (!target) return fullTag;
        inlinedCssPaths.add(target.path);
        return `<style data-vfs="${target.path}">\n${target.content}\n</style>`;
      }
    );

    // Resolve <script ... src="..."> and inline <script>
    htmlDoc = htmlDoc.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      (fullTag, attrs: string, inlineContent: string) => {
        const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
        const isModule = /\btype=["']module["']/i.test(attrs);

        if (srcMatch) {
          const src = srcMatch[1];
          if (/^https?:\/\//i.test(src)) {
            return fullTag;
          }
          const target = resolveRelativeModulePath(entryFile.path, src, files);
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
            /\.(tsx|jsx|ts|mjs)$/i.test(target.path) ||
            /\b(import|export)\b/.test(target.content);

          if (needsModule) {
            compileVirtualModule(target);
            return `<script type="module" src="${importMap[`@trenveds/${target.path}`] ?? ''}"></script>`;
          }

          return `<script data-vfs="${target.path}">\n${target.content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
        }

        // Inline <script>
        if (!inlineContent.trim()) return fullTag;

        const hasEsm = /\b(?:import|export)\b/.test(inlineContent);
        if (isModule || hasEsm) {
          const syntheticFile: SceneFile = {
            path: `${entryFile.path}.inline.js`,
            content: inlineContent,
            updatedAt: entryFile.updatedAt,
          };
          const transpiled = transpileCodeFile(syntheticFile);
          const { code: rewritten, missingRelative } = rewriteModuleImports(
            transpiled,
            entryFile.path,
            files,
            compileVirtualModule,
            (bare) => bareSpecifiers.add(bare)
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
        }

        return fullTag;
      }
    );

    // Populate importmap for any bare specifiers found
    for (const spec of bareSpecifiers) {
      const resolved = resolveExternalPackageUrl(spec);
      if (resolved.url) {
        importMap[spec] = resolved.url;
        if (resolved.prefixUrl && !resolved.rootName.startsWith('react')) {
          importMap[`${resolved.rootName}/`] = resolved.prefixUrl;
        }
      }
    }

    const injectedHeadPrelude = [
      buildDiagnosticsBridgeScript(runId),
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
      html: htmlDoc,
      dependencies: options.preparedDependencies ?? [],
      diagnostics,
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
      html,
      dependencies: [],
      diagnostics,
    };
  }

  // JS / TS / JSX / TSX entrypoint
  compileVirtualModule(entryFile);
  entryModuleKey = `@trenveds/${entryFile.path}`;

  const isReactComponentEntry =
    /\.(jsx|tsx)$/i.test(entryFile.path) &&
    !/createRoot\s*\(|ReactDOM\.render\s*\(/.test(entryFile.content);

  if (isReactComponentEntry) {
    bareSpecifiers.add('react');
    bareSpecifiers.add('react/jsx-runtime');
    bareSpecifiers.add('react-dom');
    bareSpecifiers.add('react-dom/client');

    const bootstrapCode = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as EntryMod from '${entryModuleKey}';

const rootEl = document.getElementById('root');
const Component = EntryMod.default || EntryMod.App || EntryMod.Scene;
if (!Component) {
  throw new Error('Entry module ${entryFile.path} does not export a default, App, or Scene React component.');
}
createRoot(rootEl).render(React.createElement(Component));
`;
    const bootstrapKey = '@trenveds/__bootstrap__.js';
    importMap[bootstrapKey] = toJsDataUrl(bootstrapCode);
    extraInlineScripts = `<script type="module" src="${importMap[bootstrapKey]}"></script>`;
  } else {
    extraInlineScripts = `<script type="module" src="${importMap[entryModuleKey] ?? ''}"></script>`;
  }

  // Include any un-imported project CSS files automatically so standalone App.tsx + styles.css works
  const autoCssTags = files
    .filter((f) => f.path.toLowerCase().endsWith('.css') && !inlinedCssPaths.has(f.path))
    .map((f) => `<style data-vfs="${f.path}">\n${f.content}\n</style>`)
    .join('\n');

  for (const spec of bareSpecifiers) {
    const resolved = resolveExternalPackageUrl(spec);
    if (resolved.url) {
      importMap[spec] = resolved.url;
      if (resolved.prefixUrl && !resolved.rootName.startsWith('react')) {
        importMap[`${resolved.rootName}/`] = resolved.prefixUrl;
      }
    } else {
      diagnostics.push(
        makeDiagnostic('dependency-error', `Unsupported package specifier "${spec}"`, entryFile.path)
      );
    }
  }

  headTags = [
    buildDiagnosticsBridgeScript(runId),
    `<style data-trenveds-base="1">:where(html,body,#root){margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;overflow:hidden;background:#060608;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;}</style>`,
    autoCssTags,
    buildImportMapScript(importMap),
  ]
    .filter(Boolean)
    .join('\n');

  bodyHtml = `<div id="root"></div>\n${extraInlineScripts}`;

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
    html: finalHtml,
    dependencies: options.preparedDependencies ?? [],
    diagnostics,
  };
}
