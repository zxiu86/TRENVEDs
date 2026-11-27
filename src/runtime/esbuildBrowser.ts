import type { RuntimeDiagnostic, SceneFile } from '../types/studio';
import {
  isImageAssetPath,
  normalizeScenePath,
  resolveRelativeModulePath,
} from '../utils/sceneFiles';

export interface EsbuildVfsResult {
  available: boolean;
  bundledJs?: string;
  bundledCss?: string;
  externalSpecifiers: string[];
  linkedModules: string[];
  diagnostics: RuntimeDiagnostic[];
  failureReason?: string;
}

type EsbuildBrowserModule = typeof import('esbuild-wasm');

let esbuildInitPromise: Promise<EsbuildBrowserModule | null> | null = null;

async function getEsbuildBrowser(): Promise<EsbuildBrowserModule | null> {
  if (typeof window === 'undefined' || typeof WebAssembly === 'undefined') {
    return null;
  }

  if (!esbuildInitPromise) {
    esbuildInitPromise = (async () => {
      try {
        const esbuild = await import('esbuild-wasm');
        const wasmURL =
          typeof document !== 'undefined' && document.baseURI
            ? new URL('esbuild.wasm', document.baseURI).href
            : '/esbuild.wasm';

        try {
          await esbuild.initialize({ wasmURL, worker: true });
        } catch {
          // Retry without Web Worker if container/browser blocks Blob workers
          await esbuild.initialize({ wasmURL, worker: false });
        }
        return esbuild;
      } catch (err) {
        console.warn('esbuild-wasm initialization skipped:', err);
        esbuildInitPromise = null;
        return null;
      }
    })();
  }

  return esbuildInitPromise;
}

function makeEsbuildDiagnostic(
  message: string,
  source?: string,
  line?: number,
  column?: number
): RuntimeDiagnostic {
  return {
    id: `esbuild_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'compile-error',
    severity: 'error',
    message,
    source,
    line,
    column,
    timestamp: new Date().toISOString(),
  };
}

function getEsbuildLoader(filePath: string): 'tsx' | 'ts' | 'jsx' | 'js' | 'json' | 'css' | 'text' {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'ts';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  return 'text';
}

export async function bundleWithEsbuildVfs(params: {
  files: SceneFile[];
  entryModulePath: string;
  syntheticEntryCode?: string;
  virtualFilesMap?: Map<string, SceneFile>;
}): Promise<EsbuildVfsResult> {
  const esbuild = await getEsbuildBrowser();
  if (!esbuild) {
    return {
      available: false,
      externalSpecifiers: [],
      linkedModules: [],
      diagnostics: [],
      failureReason: 'esbuild-wasm unavailable in current environment.',
    };
  }

  const allFiles: SceneFile[] = [...params.files];
  if (params.virtualFilesMap) {
    for (const vf of params.virtualFilesMap.values()) {
      if (!allFiles.some((f) => f.path === vf.path)) {
        allFiles.push(vf);
      }
    }
  }

  const fileLookup = new Map<string, SceneFile>(
    allFiles.map((f) => [normalizeScenePath(f.path), f])
  );
  const externalSet = new Set<string>();
  const linkedSet = new Set<string>();

  const syntheticPath = '__trenveds_bootstrap__.tsx';
  const entryTarget = params.syntheticEntryCode
    ? syntheticPath
    : normalizeScenePath(params.entryModulePath);

  const vfsPlugin: import('esbuild-wasm').Plugin = {
    name: 'trenveds-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === syntheticPath) {
          return { path: syntheticPath, namespace: 'vfs' };
        }

        // Ignore remote URLs & data URIs cleanly as external runtime imports
        if (/^(?:https?:)?\/\/|^data:|^blob:/i.test(args.path)) {
          return { path: args.path, external: true };
        }

        const isRelativeOrAlias =
          args.path.startsWith('./') ||
          args.path.startsWith('../') ||
          args.path.startsWith('/') ||
          args.path.startsWith('@/') ||
          args.path.startsWith('~/');

        if (!isRelativeOrAlias && args.kind !== 'entry-point') {
          // Bare npm package specifier -> keep external for importmap
          externalSet.add(args.path);
          return { path: args.path, external: true };
        }

        const fromDirPath =
          args.importer === syntheticPath ? '' : args.importer || '';

        const resolved = resolveRelativeModulePath(fromDirPath, args.path, allFiles, {
          allowBareRelative: args.kind === 'entry-point' || args.kind === 'import-rule',
        });

        if (!resolved) {
          if (isRelativeOrAlias) {
            return {
              errors: [
                {
                  text: `Unresolved relative import "${args.path}"${args.importer && args.importer !== syntheticPath ? ` (imported from ${args.importer})` : ''}`,
                },
              ],
            };
          }
          externalSet.add(args.path);
          return { path: args.path, external: true };
        }

        linkedSet.add(resolved.path);
        return { path: resolved.path, namespace: 'vfs' };
      });

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
        if (args.path === syntheticPath && params.syntheticEntryCode) {
          return {
            contents: params.syntheticEntryCode,
            loader: 'tsx',
          };
        }

        const file = fileLookup.get(normalizeScenePath(args.path));
        if (!file) {
          return {
            errors: [{ text: `File "${args.path}" was not found in TRENVEDs workspace.` }],
          };
        }

        if (isImageAssetPath(file.path)) {
          return {
            contents: `export default ${JSON.stringify(file.content)};`,
            loader: 'js',
          };
        }

        return {
          contents: file.content,
          loader: getEsbuildLoader(file.path),
        };
      });
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: [entryTarget],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      jsx: 'automatic',
      outdir: 'out',
      plugins: [vfsPlugin],
      logLevel: 'silent',
    });

    let bundledJs = '';
    let bundledCss = '';

    for (const out of result.outputFiles ?? []) {
      if (out.path.endsWith('.js') || out.path.endsWith('.mjs')) {
        bundledJs = out.text;
      } else if (out.path.endsWith('.css')) {
        bundledCss += (bundledCss ? '\n' : '') + out.text;
      }
    }

    return {
      available: true,
      bundledJs,
      bundledCss,
      externalSpecifiers: Array.from(externalSet),
      linkedModules: Array.from(linkedSet),
      diagnostics: [],
    };
  } catch (err) {
    const diagnostics: RuntimeDiagnostic[] = [];
    const failure = err as { errors?: Array<{ text: string; location?: { file?: string; line?: number; column?: number } }>; message?: string };

    if (Array.isArray(failure?.errors) && failure.errors.length > 0) {
      for (const e of failure.errors.slice(0, 6)) {
        const fileLoc = e.location?.file && e.location.file !== syntheticPath ? e.location.file : undefined;
        diagnostics.push(
          makeEsbuildDiagnostic(
            fileLoc && e.location?.line
              ? `${e.text} (${fileLoc}:${e.location.line}${e.location.column ? `:${e.location.column}` : ''})`
              : e.text,
            fileLoc,
            e.location?.line,
            e.location?.column
          )
        );
      }
    } else {
      diagnostics.push(
        makeEsbuildDiagnostic(
          err instanceof Error ? err.message : 'esbuild bundling failed.'
        )
      );
    }

    return {
      available: true,
      externalSpecifiers: Array.from(externalSet),
      linkedModules: Array.from(linkedSet),
      diagnostics,
    };
  }
}
