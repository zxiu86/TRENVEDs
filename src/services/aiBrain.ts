import {
  compileSceneBundle,
  prepareSceneDependencies,
  type CompiledSceneBundle,
} from '../runtime/sceneBundler';
import type {
  ActivityPhase,
  ActivityRun,
  ActivityStep,
  ActivityStepStatus,
  AiProviderConfig,
  AiStatus,
  AspectRatio,
  ChatMessage,
  DependencyStatus,
  FrameRate,
  RuntimeDiagnostic,
  SceneFile,
  SceneFileOperation,
} from '../types/studio';
import { applyFileOperations, normalizeScenePath } from '../utils/sceneFiles';
import { getAspectRatioSpec } from '../utils/studioLogic';
import { generateProviderCompletion, type ProviderChatMessage } from './aiProviders';

export interface AiBrainTurnOutput {
  plan: string;
  technologies: string[];
  dependencies: string[];
  operations: SceneFileOperation[];
  assistantSummary: string;
}

const MAX_REPAIR_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You are TRENVEDs AI Brain, an expert creative motion designer and frontend graphics engineer inside TRENVEDs Studio.
Your job is to create or modify real, self-contained animated scenes that execute inside a sandboxed web browser iframe sized exactly to the user's chosen aspect ratio.

CORE RULES:
1. Choose the right standard web technology for each request:
   - HTML + CSS + SVG / Vanilla JS / Canvas 2D for crisp typographic titles, geometric motion graphics, shader-like Canvas visuals, and clean CSS/WAAPI choreography.
   - React (TSX/JSX) when interactive UI overlays, structured state, or modular components fit best.
   - Standard npm ESM libraries when genuinely beneficial (e.g. "gsap", "three", "animejs", "lottie-web", "canvas-confetti", "lucide-react").
   - Never invent custom programming languages, custom animation protocols, or proprietary APIs.
2. Responsive Framing & Polish:
   - The iframe viewport matches the chosen aspect ratio (e.g. 16:9, 9:16, 1:1, 4:3).
   - Root layout must fill 100vw x 100vh cleanly with overflow: hidden (no unwanted scrollbars) and adapt gracefully at both compact previews and fullscreen.
   - Use deep cinematic contrast, crisp typography, smooth requestAnimationFrame / CSS / GSAP / Three.js motion, and restrained accents appropriate to the prompt.
3. Multi-file & Iterative Editing:
   - When modifying an existing scene, inspect the provided workspace files carefully and issue targeted "create", "update", "delete", or "rename" operations.
   - Preserve unaffected files instead of deleting or rewriting unrelated code unnecessarily.
   - If switching the project's entry architecture (e.g. from standalone index.html to React src/App.tsx), either update index.html to mount the new entry module or delete the stale index.html so the new entrypoint executes.
   - Provide complete file contents for every "create" or "update" operation (never omit lines with "...").
   - Relative imports (e.g. "./styles.css", "./components/Ring.tsx", "./motion.ts") resolve directly inside the TRENVEDs virtual filesystem.
   - If writing HTML ("index.html"), link local styles via <link rel="stylesheet" href="./styles.css" /> and local scripts via <script type="module" src="./main.js"></script> (or .ts/.tsx).
   - If writing React without index.html, provide "App.tsx" (default export or named App) or "main.tsx" calling createRoot(document.getElementById("root")!).render(...).

RESPONSE FORMAT:
Return ONLY a single valid JSON object (no markdown commentary outside the JSON) matching this exact schema:
{
  "plan": "1-2 sentences explaining your visual/technical approach.",
  "technologies": ["HTML", "CSS", "GSAP"],
  "dependencies": ["gsap"],
  "operations": [
    {
      "type": "create",
      "path": "index.html",
      "description": "Short 4-8 word purpose of file",
      "content": "Full file contents here"
    }
  ],
  "assistantSummary": "Concise 1-3 sentence plain-language summary of what was created or updated."
}

Valid operation types: "create", "update", "delete", "rename".
- For "create" and "update": "path" and "content" are required.
- For "delete": "path" is required.
- For "rename": "path" and "newPath" are required.
- "dependencies" should list bare npm package names actually imported by your code (e.g., ["three"], ["gsap"], ["react", "react-dom"]). Use [] if only browser Web APIs are used.`;

function extractJsonObjectString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner;
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error('AI response did not contain a valid JSON payload.');
}

export function parseAiBrainResponse(rawText: string): AiBrainTurnOutput {
  const jsonStr = extractJsonObjectString(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Failed to parse AI JSON response: ${err instanceof Error ? err.message : 'Invalid JSON'}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response JSON must be an object.');
  }

  const obj = parsed as Record<string, unknown>;
  const plan = typeof obj.plan === 'string' && obj.plan.trim() ? obj.plan.trim() : 'Scene update planned.';
  const technologies = Array.isArray(obj.technologies)
    ? obj.technologies.filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
    : [];
  const dependencies = Array.isArray(obj.dependencies)
    ? obj.dependencies.filter((d): d is string => typeof d === 'string' && Boolean(d.trim()))
    : [];

  const rawOps = Array.isArray(obj.operations) ? obj.operations : [];
  const operations: SceneFileOperation[] = [];

  for (const rawOp of rawOps) {
    if (!rawOp || typeof rawOp !== 'object') continue;
    const op = rawOp as Record<string, unknown>;
    const type = op.type;
    const rawPath = typeof op.path === 'string' ? normalizeScenePath(op.path) : '';
    if (!rawPath) continue;

    if (type === 'delete') {
      operations.push({ type: 'delete', path: rawPath });
      continue;
    }
    if (type === 'rename' && typeof op.newPath === 'string') {
      const newPath = normalizeScenePath(op.newPath);
      if (newPath) {
        operations.push({ type: 'rename', path: rawPath, newPath });
      }
      continue;
    }
    if ((type === 'create' || type === 'update') && typeof op.content === 'string') {
      operations.push({
        type,
        path: rawPath,
        description: typeof op.description === 'string' ? op.description.trim() : undefined,
        content: op.content,
      });
    }
  }

  const assistantSummary =
    typeof obj.assistantSummary === 'string' && obj.assistantSummary.trim()
      ? obj.assistantSummary.trim()
      : plan;

  return {
    plan,
    technologies,
    dependencies,
    operations,
    assistantSummary,
  };
}

function buildWorkspaceContextPrompt(params: {
  userPrompt: string;
  projectName: string;
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  files: SceneFile[];
  diagnostics?: RuntimeDiagnostic[];
  repairAttempt?: number;
}): string {
  const spec = getAspectRatioSpec(params.aspectRatio);
  const fileSection =
    params.files.length === 0
      ? 'WORKSPACE FILES: (empty — no scene files exist yet)'
      : [
          `WORKSPACE FILES (${params.files.length}):`,
          ...params.files.map((file) => {
            const snippet =
              file.content.length > 14000
                ? `${file.content.slice(0, 14000)}\n/* ... truncated (${file.content.length} chars) ... */`
                : file.content;
            return `--- FILE: ${file.path} ---\n${snippet}`;
          }),
        ].join('\n\n');

  const diagSection =
    params.diagnostics && params.diagnostics.length > 0
      ? [
          `RUNTIME / COMPILE ERRORS TO FIX (Repair attempt ${params.repairAttempt ?? 1}):`,
          ...params.diagnostics.map(
            (d, idx) =>
              `${idx + 1}. [${d.type}] ${d.message}${d.source ? ` (in ${d.source}${d.line ? `:${d.line}` : ''})` : ''}`
          ),
        ].join('\n')
      : '';

  return [
    `PROJECT: "${params.projectName}"`,
    `TARGET VIEWPORT: ${params.aspectRatio} (${spec.resolution}) @ ${params.frameRate} fps`,
    '',
    fileSection,
    diagSection ? `\n${diagSection}\n` : '',
    params.repairAttempt
      ? `TASK: Fix all compile/runtime errors listed above while fulfilling the user's request: "${params.userPrompt}"`
      : `USER REQUEST:\n${params.userPrompt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function createStep(
  phase: ActivityPhase,
  label: string,
  status: ActivityStepStatus,
  detail?: string
): ActivityStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    phase,
    label,
    detail,
    status,
    timestamp: new Date().toISOString(),
  };
}

export interface ExecuteAiSceneTurnParams {
  provider: AiProviderConfig;
  userPrompt: string;
  projectName: string;
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  initialFiles: SceneFile[];
  chatHistory: ChatMessage[];
  onStatusChange: (status: AiStatus) => void;
  onActivityUpdate: (run: ActivityRun) => void;
  onFilesUpdated: (files: SceneFile[], primaryTouchedPath: string | null) => void;
  mountAndVerifyRuntime: (bundle: CompiledSceneBundle) => Promise<RuntimeDiagnostic[]>;
  signal?: AbortSignal;
}

export interface ExecuteAiSceneTurnResult {
  activityRun: ActivityRun;
  finalFiles: SceneFile[];
  primaryTouchedPath: string | null;
  compiledBundle: CompiledSceneBundle | null;
  assistantMessage: string;
  isError: boolean;
}

export async function executeAiSceneTurn(
  params: ExecuteAiSceneTurnParams
): Promise<ExecuteAiSceneTurnResult> {
  const startedAt = new Date().toISOString();
  const promptPreview =
    params.userPrompt.trim().length > 90
      ? `${params.userPrompt.trim().slice(0, 90)}...`
      : params.userPrompt.trim();

  let run: ActivityRun = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    promptSummary: promptPreview,
    status: 'running',
    providerLabel: `${params.provider.name} · ${params.provider.model}`,
    technologies: [],
    inspectedFiles: [],
    createdFiles: [],
    modifiedFiles: [],
    deletedFiles: [],
    dependencies: [],
    repairAttempts: 0,
    steps: [],
    startedAt,
  };

  const pushStep = (
    phase: ActivityPhase,
    label: string,
    status: ActivityStepStatus,
    detail?: string
  ) => {
    const idx = run.steps.findIndex((s) => s.phase === phase && s.status === 'running');
    if (idx !== -1 && status !== 'running') {
      const updatedSteps = [...run.steps];
      updatedSteps[idx] = {
        ...updatedSteps[idx],
        label,
        detail: detail ?? updatedSteps[idx].detail,
        status,
        timestamp: new Date().toISOString(),
      };
      run = { ...run, steps: updatedSteps };
    } else {
      run = {
        ...run,
        steps: [...run.steps, createStep(phase, label, status, detail)],
      };
    }
    params.onActivityUpdate(run);
  };

  let workingFiles = [...params.initialFiles];
  let primaryTouchedPath: string | null = null;
  let lastCompiledBundle: CompiledSceneBundle | null = null;
  let lastSummary = '';
  const createdTotal = new Set<string>();
  const modifiedTotal = new Set<string>();
  const deletedTotal = new Set<string>();

  try {
    // 1. Analyze request
    params.onStatusChange('planning');
    pushStep('analyze', 'Analyzing scene request', 'done', `${params.aspectRatio} · ${params.frameRate} fps`);

    // 2. Inspect existing files
    const inspected = workingFiles.map((f) => f.path);
    run = { ...run, inspectedFiles: inspected };
    pushStep(
      'inspect',
      inspected.length > 0
        ? `Inspected ${inspected.length} existing scene ${inspected.length === 1 ? 'file' : 'files'}`
        : 'Inspected empty project workspace',
      'done',
      inspected.length > 0 ? inspected.join(', ') : 'Starting fresh scene'
    );

    // 3. Plan & generate code from AI provider
    params.onStatusChange('thinking');
    pushStep('plan', `Planning & generating code via ${params.provider.model}`, 'running');

    const recentMessages: ProviderChatMessage[] = params.chatHistory
      .slice(-6)
      .filter((m) => !m.isError)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const contextPrompt = buildWorkspaceContextPrompt({
      userPrompt: params.userPrompt,
      projectName: params.projectName,
      aspectRatio: params.aspectRatio,
      frameRate: params.frameRate,
      files: workingFiles,
    });

    const rawCompletion = await generateProviderCompletion(providerWithFallback(params.provider), {
      systemPrompt: SYSTEM_PROMPT,
      messages: [...recentMessages, { role: 'user', content: contextPrompt }],
      expectJson: true,
      signal: params.signal,
    });

    const aiOutput = parseAiBrainResponse(rawCompletion);
    lastSummary = aiOutput.assistantSummary;
    run = {
      ...run,
      technologies: aiOutput.technologies,
    };
    pushStep(
      'plan',
      'Planned architecture & generated scene code',
      'done',
      [aiOutput.plan, aiOutput.technologies.length ? `Stack: ${aiOutput.technologies.join(', ')}` : '']
        .filter(Boolean)
        .join(' · ')
    );

    // Apply file operations
    params.onStatusChange('generating');
    if (aiOutput.operations.length > 0) {
      const applied = applyFileOperations(workingFiles, aiOutput.operations);
      workingFiles = applied.files;
      primaryTouchedPath = applied.primaryTouchedPath ?? workingFiles[0]?.path ?? null;
      applied.created.forEach((p) => createdTotal.add(p));
      applied.modified.forEach((p) => modifiedTotal.add(p));
      applied.deleted.forEach((p) => deletedTotal.add(p));
      run = {
        ...run,
        createdFiles: Array.from(createdTotal),
        modifiedFiles: Array.from(modifiedTotal),
        deletedFiles: Array.from(deletedTotal),
      };
      params.onFilesUpdated(workingFiles, primaryTouchedPath);

      const fileSummaryParts = [
        applied.created.length ? `+${applied.created.length} created` : '',
        applied.modified.length ? `${applied.modified.length} updated` : '',
        applied.deleted.length ? `-${applied.deleted.length} deleted` : '',
      ].filter(Boolean);
      pushStep(
        'files',
        `Applied ${aiOutput.operations.length} file ${aiOutput.operations.length === 1 ? 'operation' : 'operations'}`,
        'done',
        fileSummaryParts.join(', ')
      );
    } else {
      pushStep('files', 'No file changes requested', 'skipped');
    }

    // Attempt compile -> runtime verify -> bounded repair loop
    let activeDiagnostics: RuntimeDiagnostic[] = [];

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      if (workingFiles.length === 0) {
        break;
      }

      // Prepare dependencies
      params.onStatusChange('compiling');
      pushStep('dependencies', 'Checking external dependencies', 'running');
      const deps = await prepareSceneDependencies(workingFiles, aiOutput.dependencies);
      run = { ...run, dependencies: deps };

      const failedDeps = deps.filter((d) => d.status === 'failed');
      if (failedDeps.length > 0) {
        pushStep(
          'dependencies',
          `Dependency preparation failed (${failedDeps.map((d) => d.name).join(', ')})`,
          'error',
          failedDeps.map((d) => d.error).filter(Boolean).join('; ')
        );
      } else if (deps.length > 0) {
        pushStep(
          'dependencies',
          `Prepared ${deps.length} ${deps.length === 1 ? 'dependency' : 'dependencies'}`,
          'done',
          deps.map((d) => d.name).join(', ')
        );
      } else {
        pushStep('dependencies', 'No external npm packages required', 'done');
      }

      // Compile scene bundle
      pushStep('compile', 'Compiling scene modules', 'running');
      const bundle = compileSceneBundle(workingFiles, {
        aspectRatio: params.aspectRatio,
        frameRate: params.frameRate,
        preparedDependencies: deps,
      });
      lastCompiledBundle = bundle;

      const depDiagnostics: RuntimeDiagnostic[] = failedDeps.map((d) => ({
        id: `dep_${d.name}`,
        type: 'dependency-error',
        message: d.error ?? `Failed to load package ${d.name}`,
        timestamp: new Date().toISOString(),
      }));

      const preRuntimeErrors = [...depDiagnostics, ...bundle.diagnostics];
      if (preRuntimeErrors.length > 0) {
        pushStep(
          'compile',
          'Scene compilation encountered errors',
          'error',
          preRuntimeErrors.map((d) => d.message).join(' | ')
        );
        activeDiagnostics = preRuntimeErrors;
      } else {
        pushStep('compile', `Compiled entry ${bundle.entryPath}`, 'done');
        pushStep('runtime', 'Starting isolated scene runtime', 'running');
        const runtimeErrors = await params.mountAndVerifyRuntime(bundle);
        activeDiagnostics = runtimeErrors;
        if (runtimeErrors.length === 0) {
          pushStep('runtime', 'Scene runtime active with zero errors', 'done');
          break;
        }
        pushStep(
          'runtime',
          'Runtime error detected in sandboxed viewport',
          'error',
          runtimeErrors.map((e) => e.message).join(' | ')
        );
      }

      // Trigger repair if attempts remain
      if (attempt < MAX_REPAIR_ATTEMPTS) {
        const repairNum = attempt + 1;
        run = { ...run, repairAttempts: repairNum };
        params.onStatusChange('repairing');
        pushStep(
          'repair',
          `AI repair attempt ${repairNum}/${MAX_REPAIR_ATTEMPTS}`,
          'running',
          activeDiagnostics[0]?.message
        );

        const repairPrompt = buildWorkspaceContextPrompt({
          userPrompt: params.userPrompt,
          projectName: params.projectName,
          aspectRatio: params.aspectRatio,
          frameRate: params.frameRate,
          files: workingFiles,
          diagnostics: activeDiagnostics,
          repairAttempt: repairNum,
        });

        const repairRaw = await generateProviderCompletion(params.provider, {
          systemPrompt: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: repairPrompt }],
          expectJson: true,
          signal: params.signal,
        });

        const repairOut = parseAiBrainResponse(repairRaw);
        if (repairOut.operations.length > 0) {
          const appliedRepair = applyFileOperations(workingFiles, repairOut.operations);
          workingFiles = appliedRepair.files;
          primaryTouchedPath =
            appliedRepair.primaryTouchedPath ?? primaryTouchedPath ?? workingFiles[0]?.path ?? null;
          appliedRepair.created.forEach((p) => createdTotal.add(p));
          appliedRepair.modified.forEach((p) => modifiedTotal.add(p));
          appliedRepair.deleted.forEach((p) => deletedTotal.add(p));
          run = {
            ...run,
            createdFiles: Array.from(createdTotal),
            modifiedFiles: Array.from(modifiedTotal),
            deletedFiles: Array.from(deletedTotal),
          };
          params.onFilesUpdated(workingFiles, primaryTouchedPath);
          lastSummary = repairOut.assistantSummary || lastSummary;
          pushStep(
            'repair',
            `Applied repair ${repairNum}/${MAX_REPAIR_ATTEMPTS}`,
            'done',
            repairOut.plan
          );
        } else {
          pushStep(
            'repair',
            `Repair ${repairNum} produced no file updates`,
            'error',
            activeDiagnostics[0]?.message
          );
          break;
        }
      }
    }

    if (activeDiagnostics.length > 0) {
      const errText = activeDiagnostics.map((d) => d.message).join(' | ');
      run = {
        ...run,
        status: 'error',
        errorDetail: errText,
        finalSummary: `Scene ran with unresolved errors after ${run.repairAttempts} repair ${
          run.repairAttempts === 1 ? 'attempt' : 'attempts'
        }: ${errText}`,
        finishedAt: new Date().toISOString(),
      };
      pushStep('complete', 'Finished with unresolved errors', 'error', errText);
      return {
        activityRun: run,
        finalFiles: workingFiles,
        primaryTouchedPath,
        compiledBundle: lastCompiledBundle,
        assistantMessage: `Updated the scene files, but the runtime still reported an error: ${errText}`,
        isError: true,
      };
    }

    run = {
      ...run,
      status: 'success',
      finalSummary: lastSummary,
      finishedAt: new Date().toISOString(),
    };
    pushStep('complete', 'Scene ready in Studio Viewport', 'done');

    return {
      activityRun: run,
      finalFiles: workingFiles,
      primaryTouchedPath,
      compiledBundle: lastCompiledBundle,
      assistantMessage: lastSummary,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected AI execution error.';
    run = {
      ...run,
      status: 'error',
      errorDetail: message,
      finalSummary: message,
      finishedAt: new Date().toISOString(),
    };
    pushStep('complete', 'Operation failed', 'error', message);

    return {
      activityRun: run,
      finalFiles: workingFiles,
      primaryTouchedPath,
      compiledBundle: lastCompiledBundle,
      assistantMessage: message,
      isError: true,
    };
  } finally {
    params.onStatusChange('idle');
  }
}

function providerWithFallback(p: AiProviderConfig): AiProviderConfig {
  return {
    ...p,
    baseUrl: p.baseUrl.trim(),
    model: p.model.trim(),
    apiKey: p.apiKey.trim(),
  };
}
