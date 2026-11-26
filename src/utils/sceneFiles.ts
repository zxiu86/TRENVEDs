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
  '.jsx',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
];

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

  const runnableFile = files.find((f) => /\.(tsx|jsx|ts|js|mjs)$/i.test(f.path));
  if (runnableFile) return runnableFile;

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
    if (/\.(js|mjs|ts|jsx|tsx|html|htm)$/i.test(file.path)) {
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
