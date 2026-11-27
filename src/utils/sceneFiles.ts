import type { SceneFile, SceneFileOperation } from '../types/studio';

const ENTRY_PRIORITY = [
  'index.html',
  'scene.html',
  'src/main.tsx',
  'main.tsx',
  'src/index.tsx',
  'index.tsx',
  'src/App.tsx',
  'App.tsx',
  'src/main.jsx',
  'main.jsx',
  'src/index.jsx',
  'index.jsx',
  'src/App.jsx',
  'App.jsx',
  'src/main.ts',
  'main.ts',
  'src/index.ts',
  'index.ts',
  'src/main.js',
  'main.js',
  'src/index.js',
  'index.js',
  'scene.ts',
  'scene.js',
  'sketch.js',
];

const MODULE_EXTENSION_CANDIDATES = [
  '',
  '.tsx',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.svg',
  '.glsl',
  '.vert',
  '.frag',
  '.wgsl',
  '.txt',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '/index.tsx',
  '/index.ts',
  '/index.mts',
  '/index.jsx',
  '/index.js',
  '/index.mjs',
];

export const IMAGE_ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] as const;

export const SUPPORTED_TEXT_EXTENSIONS = [
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  'json',
  'svg',
  'xml',
  'md',
  'markdown',
  'txt',
  'glsl',
  'vert',
  'frag',
  'wgsl',
  'csv',
  'yaml',
  'yml',
  'toml',
] as const;

export const SUPPORTED_SCRIPT_EXTENSIONS = [
  ...SUPPORTED_TEXT_EXTENSIONS,
  ...IMAGE_ASSET_EXTENSIONS,
] as const;

export const FILE_INPUT_ACCEPT = SUPPORTED_SCRIPT_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const MAX_IMPORTED_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportedFileValidation {
  valid: boolean;
  normalizedPath: string;
  extension: string;
  isAsset?: boolean;
  error?: string;
  warning?: string;
}

export interface ModuleSpecifierMatch {
  specifier: string;
  kind: 'import' | 'export' | 'dynamic-import' | 'require';
  isTypeOnly: boolean;
  specifierStart: number;
  specifierEnd: number;
}

export interface ProjectPackageManifest {
  name?: string;
  main?: string;
  module?: string;
  source?: string;
  type?: 'module' | 'commonjs' | string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

const IGNORED_IMPORT_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.vite',
  '.cache',
  '__pycache__',
  'dist',
  'coverage',
]);

const IGNORED_IMPORT_BASENAMES = new Set(['.ds_store', 'thumbs.db']);

export function getFileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const base = clean.split('/').pop() ?? clean;
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === base.length - 1) return '';
  return base.slice(lastDot + 1);
}

export function isImageAssetPath(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (IMAGE_ASSET_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedScriptExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (SUPPORTED_SCRIPT_EXTENSIONS as readonly string[]).includes(ext);
}

export function shouldSkipImportedPath(rawPath: string): boolean {
  const normalized = normalizeScenePath(rawPath);
  if (!normalized) return true;
  const parts = normalized.split('/');
  const base = (parts[parts.length - 1] ?? '').toLowerCase();
  if (IGNORED_IMPORT_BASENAMES.has(base)) return true;
  return parts.some((segment) => IGNORED_IMPORT_SEGMENTS.has(segment));
}

export function stripCommonImportRoot(rawPaths: string[]): string[] {
  const normalized = rawPaths.map((p) => normalizeScenePath(p));
  if (normalized.length === 0) return normalized;

  const firstSegments = normalized.map((p) => {
    const slash = p.indexOf('/');
    return slash > 0 ? p.slice(0, slash) : '';
  });

  const firstRoot = firstSegments[0];
  if (!firstRoot) return normalized;

  const allShareRoot = firstSegments.every((seg) => seg === firstRoot);
  if (!allShareRoot) return normalized;

  return normalized.map((p) => p.slice(firstRoot.length + 1));
}

export function hasBinaryControlChars(content: string): boolean {
  if (!content) return false;
  if (content.includes('\u0000')) return true;
  if (/^%PDF-|^PK\x03\x04|^\x89PNG|^\xff\xd8\xff|^GIF8[79]a/.test(content)) {
    return true;
  }
  const sample = content.slice(0, 4096);
  let controlCount = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    const isAllowedControl = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !isAllowedControl) || code === 65533) {
      controlCount += 1;
    }
  }
  return sample.length > 0 && controlCount / sample.length > 0.03;
}

export function validateImportedFile(
  filename: string,
  content: string,
  sizeBytes?: number
): ImportedFileValidation {
  const normalizedPath = normalizeScenePath(filename);
  if (!normalizedPath) {
    return {
      valid: false,
      normalizedPath: '',
      extension: '',
      error: 'Invalid or empty filename.',
    };
  }

  const ext = getFileExtension(normalizedPath);
  if (!isSupportedScriptExtension(normalizedPath)) {
    return {
      valid: false,
      normalizedPath,
      extension: ext,
      error: `Unsupported file type "${ext ? `.${ext}` : normalizedPath}". Supported types: HTML, CSS, JS/MJS/CJS, TS/MTS/CTS, JSX, TSX, JSON, SVG, XML, GLSL/WGSL, CSV, YAML, MD, TXT, and image assets (PNG/JPG/WEBP/GIF).`,
    };
  }

  const byteSize = sizeBytes ?? content.length;
  if (byteSize > MAX_IMPORTED_FILE_BYTES) {
    return {
      valid: false,
      normalizedPath,
      extension: ext,
      error: `File "${normalizedPath}" exceeds the 2 MB studio file limit.`,
    };
  }

  if (isImageAssetPath(normalizedPath)) {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(content.trim())) {
      return {
        valid: false,
        normalizedPath,
        extension: ext,
        error: `Image asset "${normalizedPath}" must be loaded as a valid image data URL.`,
      };
    }
    return {
      valid: true,
      normalizedPath,
      extension: ext,
      isAsset: true,
    };
  }

  if (hasBinaryControlChars(content)) {
    return {
      valid: false,
      normalizedPath,
      extension: ext,
      error: `File "${normalizedPath}" appears to contain binary or corrupted non-text data.`,
    };
  }

  let warning: string | undefined;
  if (ext === 'json' && content.trim()) {
    try {
      JSON.parse(content);
    } catch {
      warning = `JSON syntax issue detected in "${normalizedPath}". You can fix it directly in the Script editor.`;
    }
  }

  return {
    valid: true,
    normalizedPath,
    extension: ext,
    warning,
  };
}

export function resolveImportConflictName(existingFiles: SceneFile[], rawPath: string): string {
  const normalized = normalizeScenePath(rawPath) || 'untitled.txt';
  const existingSet = new Set(existingFiles.map((f) => f.path.toLowerCase()));
  if (!existingSet.has(normalized.toLowerCase())) {
    return normalized;
  }

  const slashIdx = normalized.lastIndexOf('/');
  const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : '';
  const file = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  const dotIdx = file.lastIndexOf('.');
  const stem = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  const ext = dotIdx > 0 ? file.slice(dotIdx) : '';

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${dir}${stem} (${n})${ext}`;
    if (!existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${dir}${stem}-${Date.now().toString(36)}${ext}`;
}

export function inferFilenameFromCode(rawCode: string, existingFiles: SceneFile[] = []): string {
  const code = rawCode.trim();
  let baseName = 'scene.js';

  if (!code) {
    baseName = 'scene.html';
  } else if (/^<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(code)) {
    baseName = 'index.html';
  } else if (/^<svg[\s>]/i.test(code)) {
    baseName = 'graphic.svg';
  } else if (/^<\?xml[\s?]/i.test(code)) {
    baseName = 'data.xml';
  } else if (
    (code.startsWith('{') || code.startsWith('[')) &&
    (() => {
      try {
        JSON.parse(code);
        return true;
      } catch {
        return false;
      }
    })()
  ) {
    baseName = 'config.json';
  } else if (
    /(?:import\s+.*from\s+['"]react['"]|export\s+(?:default\s+)?(?:function|const)\s+[A-Z]|return\s*\(\s*<[A-Za-z])/.test(
      code
    )
  ) {
    const looksLikeTs =
      /\b(?:interface|type)\s+[A-Z]|\:\s*(?:React\.FC|string|number|boolean|HTMLElement|CanvasRenderingContext2D)\b|<\s*[A-Z]\w*\s*>\(/.test(
        code
      );
    baseName = looksLikeTs ? 'App.tsx' : 'App.jsx';
  } else if (
    /\b(?:interface|type|enum)\s+[A-Z]\w*\s*[={<]|\:\s*(?:string|number|boolean|void|HTMLElement|CanvasRenderingContext2D)\b/.test(
      code
    )
  ) {
    baseName = 'scene.ts';
  } else if (
    /(?:^|\n)\s*(?:@keyframes|:root|\.[a-zA-Z_-][\w-]*|#[a-zA-Z_-][\w-]*|body|html)\s*\{[\s\S]*?(?:background|color|display|transform|animation|width|height)\s*:/.test(
      code
    )
  ) {
    baseName = 'styles.css';
  } else if (/^#{1,3}\s+\S+/m.test(code) && !/[;{}]/.test(code)) {
    baseName = 'notes.md';
  } else if (
    /<[a-z][\w-]*[\s>][\s\S]*<\/[a-z][\w-]*>/i.test(code) &&
    !/\b(const|let|var|function|import|export)\b/.test(code)
  ) {
    baseName = 'index.html';
  } else if (
    /\b(?:import|export|const|let|function|requestAnimationFrame|document\.|window\.)\b/.test(code)
  ) {
    baseName = 'main.js';
  } else {
    baseName = 'untitled.txt';
  }

  return resolveImportConflictName(existingFiles, baseName);
}

export function computeFilesSignature(files: SceneFile[]): string {
  return files
    .map((f) => `${f.path}::${f.content.length}::${f.content}`)
    .join('\n\u0000\n');
}

export function normalizeScenePath(rawPath: string): string {
  const unified = rawPath.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const segments: string[] = [];
  for (const part of unified.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

export function upsertSceneFile(
  files: SceneFile[],
  rawPath: string,
  content: string,
  description?: string,
  nowIso: string = new Date().toISOString()
): SceneFile[] {
  const path = normalizeScenePath(rawPath);
  if (!path) return files;

  const existingIndex = files.findIndex((file) => file.path === path);
  const nextFile: SceneFile = {
    path,
    content,
    description: description ?? (existingIndex >= 0 ? files[existingIndex].description : undefined),
    updatedAt: nowIso,
  };

  if (existingIndex === -1) {
    return [...files, nextFile];
  }
  return files.map((file, idx) => (idx === existingIndex ? nextFile : file));
}

export function deleteSceneFile(files: SceneFile[], rawPath: string): SceneFile[] {
  const path = normalizeScenePath(rawPath);
  return files.filter((file) => file.path !== path);
}

export function renameSceneFile(
  files: SceneFile[],
  rawOldPath: string,
  rawNewPath: string,
  nowIso: string = new Date().toISOString()
): SceneFile[] {
  const oldPath = normalizeScenePath(rawOldPath);
  const newPath = normalizeScenePath(rawNewPath);
  if (!oldPath || !newPath || oldPath === newPath) return files;

  const target = files.find((file) => file.path === oldPath);
  if (!target) return files;

  const withoutOldAndDest = files.filter(
    (file) => file.path !== oldPath && file.path !== newPath
  );
  return [
    ...withoutOldAndDest,
    {
      ...target,
      path: newPath,
      updatedAt: nowIso,
    },
  ];
}

export function applyFileOperations(
  currentFiles: SceneFile[],
  operations: SceneFileOperation[],
  nowIso: string = new Date().toISOString()
): {
  files: SceneFile[];
  created: string[];
  modified: string[];
  deleted: string[];
  primaryTouchedPath: string | null;
} {
  let nextFiles = [...currentFiles];
  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  let primaryTouchedPath: string | null = null;

  for (const op of operations) {
    const cleanPath = normalizeScenePath(op.path);
    if (!cleanPath) continue;

    if (op.type === 'delete') {
      const existed = nextFiles.some((f) => f.path === cleanPath);
      if (existed) {
        nextFiles = deleteSceneFile(nextFiles, cleanPath);
        deleted.add(cleanPath);
        created.delete(cleanPath);
        modified.delete(cleanPath);
      }
      continue;
    }

    if (op.type === 'rename' && op.newPath) {
      const cleanNew = normalizeScenePath(op.newPath);
      if (cleanNew && nextFiles.some((f) => f.path === cleanPath)) {
        nextFiles = renameSceneFile(nextFiles, cleanPath, cleanNew, nowIso);
        deleted.add(cleanPath);
        created.add(cleanNew);
        primaryTouchedPath = primaryTouchedPath ?? cleanNew;
      }
      continue;
    }

    if (op.type === 'create' || op.type === 'update') {
      if (typeof op.content !== 'string') continue;
      const existed = nextFiles.some((f) => f.path === cleanPath);
      nextFiles = upsertSceneFile(nextFiles, cleanPath, op.content, op.description, nowIso);
      if (existed) {
        if (!created.has(cleanPath)) modified.add(cleanPath);
      } else {
        created.add(cleanPath);
        deleted.delete(cleanPath);
      }
      primaryTouchedPath = primaryTouchedPath ?? cleanPath;
    }
  }

  return {
    files: nextFiles,
    created: Array.from(created),
    modified: Array.from(modified),
    deleted: Array.from(deleted),
    primaryTouchedPath,
  };
}

/**
 * Strips comments and non-module string literals into a parallel same-length string
 * so lexical module detection and regexes never match comments or log strings, while keeping
 * exact byte offsets of real import/export/require specifiers intact.
 */
export function maskCommentsAndStrings(code: string): string {
  const chars = code.split('');
  const len = chars.length;
  let i = 0;

  // Keep track of previous two non-whitespace words/punctuation to preserve specifiers after `from`, `import`, `import(`, `require(`
  let prevToken = '';
  let prevPrevToken = '';

  const pushToken = (tok: string) => {
    if (!tok) return;
    prevPrevToken = prevToken;
    prevToken = tok;
  };

  while (i < len) {
    const ch = chars[i];
    const next = chars[i + 1];

    // Line comment
    if (ch === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < len && chars[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < len) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          break;
        }
        if (chars[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      continue;
    }

    // String or template literal
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const isModuleString =
        quote !== '`' &&
        (prevToken === 'from' ||
          prevToken === 'import' ||
          (prevToken === '(' && (prevPrevToken === 'import' || prevPrevToken === 'require')));

      i += 1;
      while (i < len) {
        const cur = chars[i];
        if (cur === '\\') {
          if (!isModuleString) {
            chars[i] = ' ';
            if (i + 1 < len && chars[i + 1] !== '\n') chars[i + 1] = ' ';
          }
          i += 2;
          continue;
        }
        if (cur === quote) {
          i += 1;
          break;
        }
        if (!isModuleString && cur !== '\n') {
          chars[i] = ' ';
        }
        i += 1;
      }
      pushToken('__STR__');
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < len && /[A-Za-z0-9_$]/.test(chars[end])) end += 1;
      pushToken(code.slice(i, end));
      i = end;
      continue;
    }

    if (!/\s/.test(ch)) {
      pushToken(ch);
    }
    i += 1;
  }

  return chars.join('');
}

const STATIC_FROM_RE =
  /\b(import|export)\s+(?:(type)\s+)?(?:[\s\S]*?\bfrom\s*)(['"])([^'"\n]+)\3/g;
const SIDE_EFFECT_IMPORT_RE = /(^|[;\n}])\s*import\s+(['"])([^'"\n]+)\2/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*(?:,[\s\S]*?)?\)/g;
const CJS_REQUIRE_RE = /(?:^|[^\w$.])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

export function scanModuleSpecifiers(code: string): ModuleSpecifierMatch[] {
  const masked = maskCommentsAndStrings(code);
  const matches: ModuleSpecifierMatch[] = [];
  const seenOffsets = new Set<number>();

  let m: RegExpExecArray | null;

  STATIC_FROM_RE.lastIndex = 0;
  while ((m = STATIC_FROM_RE.exec(masked)) !== null) {
    const kind = m[1] === 'export' ? 'export' : 'import';
    const isTypeOnly = m[2] === 'type';
    const spec = m[4];
    const specStart = m.index + m[0].lastIndexOf(m[3] + spec + m[3]) + 1;
    const specEnd = specStart + spec.length;
    if (!seenOffsets.has(specStart)) {
      seenOffsets.add(specStart);
      matches.push({
        specifier: spec,
        kind,
        isTypeOnly,
        specifierStart: specStart,
        specifierEnd: specEnd,
      });
    }
  }

  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(masked)) !== null) {
    const spec = m[3];
    const specStart = m.index + m[0].lastIndexOf(m[2] + spec + m[2]) + 1;
    const specEnd = specStart + spec.length;
    if (!seenOffsets.has(specStart)) {
      seenOffsets.add(specStart);
      matches.push({
        specifier: spec,
        kind: 'import',
        isTypeOnly: false,
        specifierStart: specStart,
        specifierEnd: specEnd,
      });
    }
  }

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(masked)) !== null) {
    const spec = m[2];
    const specStart = m.index + m[0].lastIndexOf(m[1] + spec + m[1]) + 1;
    const specEnd = specStart + spec.length;
    if (!seenOffsets.has(specStart)) {
      seenOffsets.add(specStart);
      matches.push({
        specifier: spec,
        kind: 'dynamic-import',
        isTypeOnly: false,
        specifierStart: specStart,
        specifierEnd: specEnd,
      });
    }
  }

  CJS_REQUIRE_RE.lastIndex = 0;
  while ((m = CJS_REQUIRE_RE.exec(masked)) !== null) {
    const spec = m[2];
    const specStart = m.index + m[0].lastIndexOf(m[1] + spec + m[1]) + 1;
    const specEnd = specStart + spec.length;
    if (!seenOffsets.has(specStart)) {
      seenOffsets.add(specStart);
      matches.push({
        specifier: spec,
        kind: 'require',
        isTypeOnly: false,
        specifierStart: specStart,
        specifierEnd: specEnd,
      });
    }
  }

  matches.sort((a, b) => a.specifierStart - b.specifierStart);
  return matches;
}

export function hasRealEsmSyntax(code: string): boolean {
  const masked = maskCommentsAndStrings(code);
  if (scanModuleSpecifiers(code).some((m) => m.kind !== 'require')) {
    return true;
  }
  return /(?:^|[;\n{}])\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|async\s+function\b|class\b|\{|\*|\btype\b|\binterface\b)/.test(
    masked
  );
}

export function hasCommonJsSyntax(code: string): boolean {
  const masked = maskCommentsAndStrings(code);
  return (
    /(?:^|[^\w$.])require\s*\(/.test(masked) ||
    /\bmodule\.exports\b/.test(masked) ||
    /(?:^|[;\n])\s*exports\.[A-Za-z_$]/.test(masked)
  );
}

export function parseProjectPackageJson(files: SceneFile[]): ProjectPackageManifest | null {
  const pkgFile = files.find((f) => f.path.toLowerCase() === 'package.json');
  if (!pkgFile) return null;
  try {
    const parsed = JSON.parse(pkgFile.content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const toStringMap = (value: unknown): Record<string, string> => {
      if (!value || typeof value !== 'object') return {};
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') result[k] = v;
      }
      return result;
    };

    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      main: typeof parsed.main === 'string' ? parsed.main : undefined,
      module: typeof parsed.module === 'string' ? parsed.module : undefined,
      source: typeof parsed.source === 'string' ? parsed.source : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      dependencies: toStringMap(parsed.dependencies),
      devDependencies: toStringMap(parsed.devDependencies),
      peerDependencies: toStringMap(parsed.peerDependencies),
    };
  } catch {
    return null;
  }
}

export function detectSceneEntryFile(files: SceneFile[]): SceneFile | null {
  if (files.length === 0) return null;

  for (const candidate of ENTRY_PRIORITY) {
    const match = files.find((f) => f.path.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }

  // Respect public/index.html only if there is no React src entry when public/index.html has no script
  const publicHtml = files.find((f) => f.path.toLowerCase() === 'public/index.html');
  const htmlFile = files.find((f) => /\.(html|htm)$/i.test(f.path) && f.path.toLowerCase() !== 'public/index.html');
  if (htmlFile) return htmlFile;

  const pkg = parseProjectPackageJson(files);
  if (pkg) {
    for (const pkgEntry of [pkg.source, pkg.module, pkg.main]) {
      if (pkgEntry) {
        const resolved = resolveRelativeModulePath('', pkgEntry, files, { allowBareRelative: true });
        if (resolved) return resolved;
      }
    }
  }

  const runnableFile = files.find((f) =>
    /\.(tsx|jsx|ts|mts|cts|js|mjs|cjs)$/i.test(f.path) &&
    !/^(?:vite|tailwind|postcss|eslint|jest|vitest)\.config\./i.test(f.path)
  );
  if (runnableFile) return runnableFile;

  if (publicHtml) return publicHtml;

  const svgFile = files.find((f) => /\.svg$/i.test(f.path));
  if (svgFile) return svgFile;

  return files[0];
}

export interface ResolveModuleOptions {
  allowBareRelative?: boolean;
}

function findFileWithExtensions(baseTarget: string, files: SceneFile[]): SceneFile | null {
  const byExact = new Map(files.map((file) => [file.path, file]));
  const byLower = new Map(files.map((file) => [file.path.toLowerCase(), file]));

  const lookup = (candidate: string): SceneFile | null =>
    byExact.get(candidate) ?? byLower.get(candidate.toLowerCase()) ?? null;

  for (const suffix of MODULE_EXTENSION_CANDIDATES) {
    const hit = lookup(`${baseTarget}${suffix}`);
    if (hit) return hit;
  }

  // Support TypeScript ESM import convention: `./foo.js` resolving to `foo.ts` / `foo.tsx` / `foo.mts` / `foo.jsx`
  const tsMapped: string[] = [];
  if (/\.js$/i.test(baseTarget)) {
    const stem = baseTarget.slice(0, -3);
    tsMapped.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.jsx`);
  } else if (/\.jsx$/i.test(baseTarget)) {
    const stem = baseTarget.slice(0, -4);
    tsMapped.push(`${stem}.tsx`);
  } else if (/\.mjs$/i.test(baseTarget)) {
    const stem = baseTarget.slice(0, -4);
    tsMapped.push(`${stem}.mts`, `${stem}.ts`);
  } else if (/\.cjs$/i.test(baseTarget)) {
    const stem = baseTarget.slice(0, -4);
    tsMapped.push(`${stem}.cts`, `${stem}.ts`);
  }

  for (const mapped of tsMapped) {
    const hit = lookup(mapped);
    if (hit) return hit;
  }

  return null;
}

export function resolveRelativeModulePath(
  fromPath: string,
  specifier: string,
  files: SceneFile[],
  options: ResolveModuleOptions = {}
): SceneFile | null {
  const cleanSpec = specifier.trim().split('?')[0].split('#')[0];
  if (!cleanSpec) return null;

  if (
    /^(?:https?:)?\/\//i.test(cleanSpec) ||
    cleanSpec.startsWith('data:') ||
    cleanSpec.startsWith('blob:') ||
    cleanSpec.startsWith('@trenveds/')
  ) {
    return null;
  }

  // Handle `@/` and `~/` Vite/TS project aliases
  if (cleanSpec.startsWith('@/') || cleanSpec.startsWith('~/')) {
    const sub = cleanSpec.slice(2);
    return (
      findFileWithExtensions(`src/${sub}`, files) ??
      findFileWithExtensions(sub, files)
    );
  }

  const isExplicitRelative =
    cleanSpec.startsWith('./') || cleanSpec.startsWith('../') || cleanSpec.startsWith('/');

  if (!isExplicitRelative && !options.allowBareRelative) {
    return null;
  }

  const cleanFrom = normalizeScenePath(fromPath);
  const fromDirParts = cleanFrom.includes('/') ? cleanFrom.split('/').slice(0, -1) : [];

  let resolvedParts: string[];
  if (cleanSpec.startsWith('/')) {
    resolvedParts = [];
  } else {
    resolvedParts = [...fromDirParts];
  }

  for (const part of cleanSpec.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolvedParts.length > 0) resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  const baseTarget = resolvedParts.join('/');
  const directHit = findFileWithExtensions(baseTarget, files);
  if (directHit) return directHit;

  // Fallback for root-relative `/assets/logo.svg` or bare `styles.css` in `public/` or root
  if (cleanSpec.startsWith('/')) {
    return findFileWithExtensions(`public/${baseTarget}`, files);
  }
  if (!isExplicitRelative && fromDirParts.length > 0) {
    const rootTarget = normalizeScenePath(cleanSpec);
    return (
      findFileWithExtensions(rootTarget, files) ??
      findFileWithExtensions(`public/${rootTarget}`, files)
    );
  }

  return null;
}

export function getPackageRootName(specifier: string): string {
  const clean = specifier.trim().split('?')[0].split('#')[0];
  if (clean.startsWith('@')) {
    const parts = clean.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : clean;
  }
  return clean.split('/')[0];
}

export function extractBareSpecifiersFromCode(code: string): string[] {
  const found = new Set<string>();
  const matches = scanModuleSpecifiers(code);

  for (const match of matches) {
    if (match.isTypeOnly) continue;
    const spec = match.specifier.trim();
    if (!spec) continue;
    if (
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/') ||
      spec.startsWith('@/') ||
      spec.startsWith('~/') ||
      spec.startsWith('@trenveds/') ||
      spec.startsWith('http://') ||
      spec.startsWith('https://') ||
      spec.startsWith('data:') ||
      spec.startsWith('blob:')
    ) {
      continue;
    }
    found.add(spec);
  }

  return Array.from(found);
}

const BUILD_TOOL_PACKAGES = new Set([
  'vite',
  'typescript',
  'tailwindcss',
  '@tailwindcss/vite',
  '@vitejs/plugin-react',
  '@vitejs/plugin-react-swc',
  'autoprefixer',
  'postcss',
  'eslint',
  'prettier',
  'tsx',
  'esbuild',
  'vitest',
  'jest',
]);

export function extractSceneExternalDependencies(files: SceneFile[]): string[] {
  const specifiers = new Set<string>();
  let usesJsx = false;

  for (const file of files) {
    if (/\.(jsx|tsx)$/i.test(file.path)) {
      usesJsx = true;
    }
    if (/\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(file.path)) {
      for (const spec of extractBareSpecifiersFromCode(file.content)) {
        specifiers.add(spec);
      }
    } else if (/\.(html|htm)$/i.test(file.path)) {
      const inlineMatches = file.content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
      for (const m of inlineMatches) {
        const inlineBody = m[1] ?? '';
        for (const spec of extractBareSpecifiersFromCode(inlineBody)) {
          specifiers.add(spec);
        }
      }
    }
  }

  // Merge runtime dependencies declared in package.json (skipping build-only tooling)
  const pkg = parseProjectPackageJson(files);
  if (pkg) {
    for (const depName of Object.keys(pkg.dependencies)) {
      if (!BUILD_TOOL_PACKAGES.has(depName) && !depName.startsWith('@types/')) {
        if (depName === 'react' || depName === 'react-dom') {
          specifiers.add(depName);
        }
      }
    }
  }

  if (usesJsx || specifiers.has('react') || specifiers.has('react-dom')) {
    specifiers.add('react');
    specifiers.add('react/jsx-runtime');
    specifiers.add('react-dom');
    specifiers.add('react-dom/client');
  }

  return Array.from(specifiers);
}
