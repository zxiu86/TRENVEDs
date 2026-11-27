import type { SceneFile, SceneFileOperation } from '../types/studio';

const ENTRY_PRIORITY = [
  'index.html',
  'scene.html',
  'src/main.tsx',
  'main.tsx',
  'src/App.tsx',
  'App.tsx',
  'src/main.jsx',
  'main.jsx',
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
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
];

export const SUPPORTED_SCRIPT_EXTENSIONS = [
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
] as const;

export const FILE_INPUT_ACCEPT = SUPPORTED_SCRIPT_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const MAX_IMPORTED_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportedFileValidation {
  valid: boolean;
  normalizedPath: string;
  extension: string;
  error?: string;
  warning?: string;
}

export function getFileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const base = clean.split('/').pop() ?? clean;
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === base.length - 1) return '';
  return base.slice(lastDot + 1);
}

export function isSupportedScriptExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (SUPPORTED_SCRIPT_EXTENSIONS as readonly string[]).includes(ext);
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
      error: `Unsupported file type "${ext ? `.${ext}` : normalizedPath}". Supported types: HTML, CSS, JS/MJS/CJS, TS/MTS/CTS, JSX, TSX, JSON, SVG, XML, MD, TXT.`,
    };
  }

  const byteSize = sizeBytes ?? content.length;
  if (byteSize > MAX_IMPORTED_FILE_BYTES) {
    return {
      valid: false,
      normalizedPath,
      extension: ext,
      error: `File "${normalizedPath}" exceeds the 2 MB studio text-file limit.`,
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
  } else if ((code.startsWith('{') || code.startsWith('[')) && (() => {
    try {
      JSON.parse(code);
      return true;
    } catch {
      return false;
    }
  })()) {
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
    /\b(?:interface|type)\s+[A-Z]\w*\s*[={<]|\:\s*(?:string|number|boolean|void|HTMLElement|CanvasRenderingContext2D)\b/.test(
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
  } else if (/<[a-z][\w-]*[\s>][\s\S]*<\/[a-z][\w-]*>/i.test(code) && !/\b(const|let|var|function|import|export)\b/.test(code)) {
    baseName = 'index.html';
  } else if (/\b(?:import|export|const|let|function|requestAnimationFrame|document\.|window\.)\b/.test(code)) {
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

export function detectSceneEntryFile(files: SceneFile[]): SceneFile | null {
  if (files.length === 0) return null;

  for (const candidate of ENTRY_PRIORITY) {
    const match = files.find((f) => f.path.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }

  const htmlFile = files.find((f) => /\.(html|htm)$/i.test(f.path));
  if (htmlFile) return htmlFile;

  const runnableFile = files.find((f) => /\.(tsx|jsx|ts|mts|cts|js|mjs|cjs)$/i.test(f.path));
  if (runnableFile) return runnableFile;

  const svgFile = files.find((f) => /\.svg$/i.test(f.path));
  if (svgFile) return svgFile;

  return files[0];
}

export function resolveRelativeModulePath(
  fromPath: string,
  specifier: string,
  files: SceneFile[]
): SceneFile | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) {
    return null;
  }

  const cleanFrom = normalizeScenePath(fromPath);
  const fromDirParts = cleanFrom.includes('/') ? cleanFrom.split('/').slice(0, -1) : [];

  let resolvedParts: string[];
  if (specifier.startsWith('/')) {
    resolvedParts = [];
  } else {
    resolvedParts = [...fromDirParts];
  }

  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolvedParts.length > 0) resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  const baseTarget = resolvedParts.join('/');
  const byExactOrExt = new Map(files.map((file) => [file.path, file]));

  for (const suffix of MODULE_EXTENSION_CANDIDATES) {
    const candidate = `${baseTarget}${suffix}`;
    const hit = byExactOrExt.get(candidate);
    if (hit) return hit;
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

const IMPORT_RE =
  /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

export function extractBareSpecifiersFromCode(code: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(code)) !== null) {
    const spec = match[1]?.trim();
    if (!spec) continue;
    if (
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/') ||
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

export function extractSceneExternalDependencies(files: SceneFile[]): string[] {
  const specifiers = new Set<string>();
  let usesJsx = false;

  for (const file of files) {
    if (/\.(jsx|tsx)$/i.test(file.path)) {
      usesJsx = true;
    }
    if (/\.(js|mjs|cjs|ts|mts|cts|jsx|tsx|html|htm)$/i.test(file.path)) {
      for (const spec of extractBareSpecifiersFromCode(file.content)) {
        specifiers.add(spec);
      }
    }
  }

  if (usesJsx) {
    specifiers.add('react');
    specifiers.add('react/jsx-runtime');
    specifiers.add('react-dom');
    specifiers.add('react-dom/client');
  }

  return Array.from(specifiers);
}
