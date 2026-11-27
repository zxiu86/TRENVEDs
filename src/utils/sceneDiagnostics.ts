import { transform } from 'sucrase';
import type { SceneFile } from '../types/studio';
import {
  detectSceneEntryFile,
  extractBareSpecifiersFromCode,
  extractSceneExternalDependencies,
  resolveRelativeModulePath,
  scanModuleSpecifiers,
} from './sceneFiles';
import {
  detectCircularDependencies,
  resolveExternalPackageUrl,
} from '../runtime/sceneBundler';

export interface WorkspaceIssue {
  id: string;
  severity: 'error' | 'warning';
  file?: string;
  message: string;
  suggestion: string;
}

export interface WorkspaceAuditReport {
  entryPath: string | null;
  fileCount: number;
  externalDependencies: string[];
  issues: WorkspaceIssue[];
  summary: string;
}

function hasProbableJsxSyntax(code: string): boolean {
  return /\breturn\s*\(?\s*<[A-Za-z][A-Za-z0-9]*(?:\s|>|\/>)/.test(code) ||
    /React\.createElement/.test(code) === false && /<[A-Z][A-Za-z0-9]*\b[^>]*\/?>/.test(code);
}

export function auditSceneWorkspace(files: SceneFile[]): WorkspaceAuditReport {
  if (files.length === 0) {
    return {
      entryPath: null,
      fileCount: 0,
      externalDependencies: [],
      issues: [],
      summary: 'Empty project workspace.',
    };
  }

  const entryFile = detectSceneEntryFile(files);
  const externalDependencies = extractSceneExternalDependencies(files);
  const issues: WorkspaceIssue[] = [];

  // 1. Check stale HTML entrypoint shadowing React entrypoints
  if (entryFile && /\.(html|htm)$/i.test(entryFile.path)) {
    const reactEntry = files.find((f) =>
      /^(?:src\/)?(?:App|main)\.(tsx|jsx)$/i.test(f.path)
    );
    if (
      reactEntry &&
      !entryFile.content.includes(reactEntry.path) &&
      !entryFile.content.includes(reactEntry.path.replace(/^src\//, ''))
    ) {
      issues.push({
        id: 'stale-html-shadowing',
        severity: 'warning',
        file: entryFile.path,
        message: `${entryFile.path} takes entry priority and does not reference ${reactEntry.path}, so ${reactEntry.path} will not execute.`,
        suggestion: `Update ${entryFile.path} to load ${reactEntry.path} or remove stale ${entryFile.path}.`,
      });
    }
  }

  // 2. Inspect each file for syntax, missing imports, HTML links, JSX-in-JS, and dependency validity
  for (const file of files) {
    const lower = file.path.toLowerCase();

    if (lower.endsWith('.json')) {
      try {
        JSON.parse(file.content);
      } catch (err) {
        issues.push({
          id: `json-syntax-${file.path}`,
          severity: 'error',
          file: file.path,
          message: `Invalid JSON in ${file.path}: ${err instanceof Error ? err.message : 'Syntax error'}`,
          suggestion: `Fix JSON formatting in ${file.path}.`,
        });
      }
    }

    if (/\.(ts|mts|cts|tsx|jsx)$/i.test(lower)) {
      const transforms: Array<'typescript' | 'jsx'> = [];
      if (/\.(ts|mts|cts|tsx)$/i.test(lower)) transforms.push('typescript');
      if (/\.(jsx|tsx)$/i.test(lower)) transforms.push('jsx');
      try {
        transform(file.content, {
          transforms,
          jsxRuntime: 'automatic',
          production: true,
          filePath: file.path,
        });
      } catch (err) {
        issues.push({
          id: `transpile-${file.path}`,
          severity: 'error',
          file: file.path,
          message: `Syntax error in ${file.path}: ${err instanceof Error ? err.message : 'Failed to parse'}`,
          suggestion: `Repair TypeScript/JSX syntax in ${file.path}.`,
        });
      }
    }

    if (/\.(js|mjs|cjs)$/i.test(lower) && hasProbableJsxSyntax(file.content)) {
      issues.push({
        id: `jsx-in-js-${file.path}`,
        severity: 'error',
        file: file.path,
        message: `JSX syntax detected inside ${file.path}, which is treated as plain JavaScript.`,
        suggestion: `Rename ${file.path} to .jsx/.tsx or replace JSX with standard DOM/React.createElement calls.`,
      });
    }

    if (/\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(lower)) {
      for (const match of scanModuleSpecifiers(file.content)) {
        if (match.isTypeOnly) continue;
        const spec = match.specifier.trim();
        const isRelativeOrAlias =
          spec.startsWith('./') ||
          spec.startsWith('../') ||
          spec.startsWith('/') ||
          spec.startsWith('@/') ||
          spec.startsWith('~/');
        if (isRelativeOrAlias && !resolveRelativeModulePath(file.path, spec, files)) {
          issues.push({
            id: `missing-import-${file.path}-${spec}`,
            severity: 'error',
            file: file.path,
            message: `Unresolved relative import "${spec}" in ${file.path}.`,
            suggestion: `Create the missing module or update the import path in ${file.path}.`,
          });
        }
      }

      for (const bare of extractBareSpecifiersFromCode(file.content)) {
        const resolved = resolveExternalPackageUrl(bare);
        if (!resolved.url) {
          issues.push({
            id: `invalid-pkg-${file.path}-${bare}`,
            severity: 'error',
            file: file.path,
            message:
              resolved.incompatibilityReason ??
              `Unsupported or malformed package import "${bare}" in ${file.path}.`,
            suggestion: `Replace "${bare}" with a browser-compatible npm package or Web API.`,
          });
        }
      }
    }

    if (/\.(html|htm)$/i.test(lower)) {
      const scriptSrcMatches = file.content.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi);
      for (const m of scriptSrcMatches) {
        const src = m[1]?.trim();
        if (!src || /^(?:https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) continue;
        if (!resolveRelativeModulePath(file.path, src, files, { allowBareRelative: true })) {
          issues.push({
            id: `missing-html-script-${file.path}-${src}`,
            severity: 'error',
            file: file.path,
            message: `Script src "${src}" in ${file.path} does not exist in project files.`,
            suggestion: `Create "${src}" or fix the <script src> path in ${file.path}.`,
          });
        }
      }

      const cssHrefMatches = file.content.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi);
      for (const m of cssHrefMatches) {
        const href = m[1]?.trim();
        if (!href || /^(?:https?:)?\/\//i.test(href) || href.startsWith('data:') || href.startsWith('blob:')) continue;
        if (!resolveRelativeModulePath(file.path, href, files, { allowBareRelative: true })) {
          issues.push({
            id: `missing-html-css-${file.path}-${href}`,
            severity: 'error',
            file: file.path,
            message: `Stylesheet href "${href}" in ${file.path} does not exist in project files.`,
            suggestion: `Create "${href}" or fix the stylesheet link in ${file.path}.`,
          });
        }
      }
    }
  }

  // 2b. Circular dependency check across ES/TS modules
  const graphEdges = new Map<string, Set<string>>();
  for (const file of files) {
    if (!/\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(file.path)) continue;
    for (const match of scanModuleSpecifiers(file.content)) {
      if (match.isTypeOnly) continue;
      const target = resolveRelativeModulePath(file.path, match.specifier, files);
      if (target) {
        let edges = graphEdges.get(file.path);
        if (!edges) {
          edges = new Set<string>();
          graphEdges.set(file.path, edges);
        }
        edges.add(target.path);
      }
    }
  }
  for (const cycle of detectCircularDependencies(graphEdges)) {
    const chain = cycle.join(' -> ');
    issues.push({
      id: `circular-dep-${chain}`,
      severity: 'warning',
      file: cycle[0],
      message: `Circular module dependency detected: ${chain}.`,
      suggestion: 'Extract shared state or types into a separate leaf module to prevent initialization-order errors.',
    });
  }

  // 3. Check React component entrypoint exports
  if (
    entryFile &&
    /\.(jsx|tsx)$/i.test(entryFile.path) &&
    !/createRoot\s*\(|ReactDOM\.render\s*\(/.test(entryFile.content)
  ) {
    const hasExport =
      /\bexport\s+default\b/.test(entryFile.content) ||
      /\bexport\s+(?:async\s+)?(?:function|const|class|let|var)\s+(?:App|Scene)\b/.test(entryFile.content) ||
      /\bexport\s*\{[^}]*\b(?:default|App|Scene)\b/.test(entryFile.content);
    if (!hasExport) {
      issues.push({
        id: `missing-react-export-${entryFile.path}`,
        severity: 'error',
        file: entryFile.path,
        message: `Entry module ${entryFile.path} does not export a default, App, or Scene React component.`,
        suggestion: `Export a default React component (e.g. "export default function App() { ... }") from ${entryFile.path}.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const summary =
    issues.length === 0
      ? `Checked ${files.length} file${files.length === 1 ? '' : 's'} (entry: ${entryFile?.path ?? 'none'}): zero static issues detected.`
      : `Found ${errorCount} error${errorCount === 1 ? '' : 's'} and ${warningCount} warning${warningCount === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}.`;

  return {
    entryPath: entryFile?.path ?? null,
    fileCount: files.length,
    externalDependencies,
    issues,
    summary,
  };
}

const DIAGNOSTIC_KEYWORDS_RE =
  /\b(?:fix|bug|error|broken|issue|problem|debug|why|doesn't work|does not work|not working|fail|crash|black screen|blank|investigate|diagnose|audit|compatib|check|review|refactor|optimize|troubleshoot)\b|مشكلة|مشاكل|خطأ|أخطاء|لا يعمل|ما يشتغل|تعطل|إصلاح|اصلح|فحص|تشخيص|سبب|توافق|راجع|مراجعة|تحسين/i;

const RESEARCH_KEYWORDS_RE =
  /\b(?:three|three\.js|gsap|animejs|lottie|framer-motion|motion|p5|d3|shader|webgl|webgpu|audio|canvas|svg|esm|cdn|compatibility|deprecated|version|browser api)\b/i;

export function detectDiagnosticIntent(
  userPrompt: string,
  files: SceneFile[],
  audit: WorkspaceAuditReport
): boolean {
  if (audit.issues.length > 0) return true;
  if (DIAGNOSTIC_KEYWORDS_RE.test(userPrompt)) return true;
  if (files.length >= 3) return true;
  return false;
}

export function shouldUseWebResearch(
  userPrompt: string,
  files: SceneFile[],
  audit: WorkspaceAuditReport
): boolean {
  if (RESEARCH_KEYWORDS_RE.test(userPrompt)) return true;
  if (audit.externalDependencies.some((d) => !['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(d))) {
    return true;
  }
  if (audit.issues.some((i) => i.id.startsWith('invalid-pkg-') || i.id.startsWith('stale-'))) {
    return true;
  }
  if (files.some((f) => /\b(three|gsap|lottie|framer-motion|animejs|WebGL)\b/i.test(f.content)) && DIAGNOSTIC_KEYWORDS_RE.test(userPrompt)) {
    return true;
  }
  return false;
}
