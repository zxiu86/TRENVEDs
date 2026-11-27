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
  AiCandidateOption,
  AiProviderConfig,
  AiStatus,
  AiWebSource,
  AspectRatio,
  ChatMessage,
  FrameRate,
  RuntimeDiagnostic,
  SceneFile,
  SceneFileOperation,
} from '../types/studio';
import { applyFileOperations, normalizeScenePath } from '../utils/sceneFiles';
import {
  auditSceneWorkspace,
  detectDiagnosticIntent,
  shouldUseWebResearch,
  type WorkspaceAuditReport,
} from '../utils/sceneDiagnostics';
import { getAspectRatioSpec } from '../utils/studioLogic';
import {
  generateProviderCompletionDetailed,
  type ProviderChatMessage,
} from './aiProviders';

export interface AiBrainTurnOutput {
  plan: string;
  diagnosis?: string;
  candidateSolutions?: AiCandidateOption[];
  selfReviewNote?: string;
  selectionRationale?: string;
  technologies: string[];
  dependencies: string[];
  operations: SceneFileOperation[];
  assistantSummary: string;
}

interface RepairAttemptRecord {
  attempt: number;
  errorSummary: string;
  planTried: string;
  filesTouched: string[];
}

const MAX_REPAIR_ATTEMPTS = 2;

const CORE_SYSTEM_RULES = `You are TRENVEDs AI Brain, an expert creative motion designer, software engineer, and diagnostics specialist inside TRENVEDs Studio.
Your job is to create, inspect, diagnose, or modify real, self-contained animated scenes that execute inside a sandboxed web browser iframe sized exactly to the user's chosen aspect ratio.

CORE RUNTIME ENVIRONMENT RULES:
1. Choose the right standard web technology for each request:
   - HTML + CSS + SVG / Vanilla JS / Canvas 2D for crisp typographic titles, geometric motion graphics, shader-like Canvas visuals, and clean CSS/WAAPI choreography.
   - React (TSX/JSX) when interactive UI overlays, structured state, or modular components fit best.
   - Standard npm ESM libraries when genuinely beneficial (e.g. "gsap", "three", "animejs", "lottie-web", "canvas-confetti", "lucide-react").
   - Never invent custom programming languages, custom animation protocols, or proprietary APIs.
2. Sandboxed Browser Runtime Facts (Verify every assumption against these):
   - TypeScript/JSX files (.ts, .mts, .cts, .tsx, .jsx) are transpiled via Sucrase (JSX automatic runtime) and resolved via browser <script type="importmap"> using esm.sh (React pinned to 19.1.0).
   - Plain .js/.mjs/.cjs files are NOT JSX-transformed—never put JSX syntax inside .js files.
   - Entry priority: index.html -> scene.html -> src/main.tsx -> main.tsx -> src/App.tsx -> App.tsx -> src/main.jsx -> main.jsx -> src/App.jsx -> App.jsx -> .ts/.js.
   - If index.html exists alongside React files (App.tsx/main.tsx) and does not import them, index.html shadows React! Update index.html or delete the stale index.html.
   - If writing React without index.html, export a default, App, or Scene component (or call createRoot(document.getElementById("root")!).render(...)).
   - Relative imports (e.g. "./styles.css", "./components/Ring.tsx") resolve inside TRENVEDs virtual filesystem.
   - Root layout must fill 100vw x 100vh cleanly with overflow: hidden (no unwanted scrollbars) and adapt gracefully at compact preview sizes and fullscreen.
3. Multi-file & Iterative Editing:
   - Inspect all workspace files carefully and issue targeted "create", "update", "delete", or "rename" operations.
   - Preserve unaffected files instead of rewriting unrelated code unnecessarily.
   - Provide complete file contents for every "create" or "update" operation (never omit lines with "...").`;

const SYSTEM_PROMPT = `${CORE_SYSTEM_RULES}

RESPONSE FORMAT:
Return ONLY a single valid JSON object (no markdown commentary outside the JSON) matching this schema:
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

const DEEP_REVIEW_SYSTEM_PROMPT = `${CORE_SYSTEM_RULES}

DEEP DIAGNOSTIC & SELF-REVIEW PROTOCOL (REQUIRED FOR THIS TASK):
1. AUTONOMOUS INSPECTION & ROOT-CAUSE DIAGNOSIS:
   - Examine every file, import path, entrypoint order, library version/API usage, DOM mount target, CSS sizing, and static audit finding.
   - Do not rely only on the user's symptoms—actively hunt for hidden compatibility bugs, silent failures, race conditions, or architectural mismatches.
2. MULTI-OPTION GENERATION & SEPARATE CRITIQUE:
   - Propose 2 to 3 genuinely distinct candidate technical approaches (not minor wording variations).
   - Critique each option honestly: identify weaknesses, compatibility risks, side effects, and whether it solves the root cause vs only masking a symptom.
3. SELF-REVIEW & FINAL SELECTION:
   - Double-check every runtime assumption before finalizing code (React 19.1.0 esm.sh compatibility, Sucrase transforms, HTML <script>/<link> paths, cleanup on unmount, animation loop bounds).
   - If fixing a previously failed attempt, you MUST NOT repeat a failed strategy—choose a genuinely distinct root-cause fix.
4. HONEST REPORTING:
   - Summarize only concrete technical findings and verified facts. Never invent test results or external sources.

RESPONSE FORMAT:
Return ONLY a single valid JSON object matching this exact schema:
{
  "diagnosis": "Concise root-cause diagnosis of current and potential issues discovered in the workspace.",
  "candidateSolutions": [
    {
      "approach": "Short description of option A",
      "critique": "Weaknesses, compatibility risks, and side effects of option A",
      "selected": false
    },
    {
      "approach": "Short description of option B",
      "critique": "Why option B resolves root causes cleanly and any remaining caveats",
      "selected": true
    }
  ],
  "selfReviewNote": "Concise verification checklist note confirming compatibility, entrypoints, dependencies, and edge cases.",
  "selectionRationale": "1-2 sentences explaining why the selected approach is the safest and most effective solution.",
  "plan": "1-2 sentences describing the exact file changes being applied.",
  "technologies": ["React", "Three.js"],
  "dependencies": ["three"],
  "operations": [
    {
      "type": "update",
      "path": "src/App.tsx",
      "description": "Short 4-8 word purpose of change",
      "content": "Complete file contents here"
    }
  ],
  "assistantSummary": "Clear plain-language summary of what was diagnosed, verified, and updated."
}`;

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
  const plan =
    typeof obj.plan === 'string' && obj.plan.trim()
      ? obj.plan.trim()
      : 'Scene update planned.';
  const diagnosis =
    typeof obj.diagnosis === 'string' && obj.diagnosis.trim()
      ? obj.diagnosis.trim()
      : undefined;
  const selfReviewNote =
    typeof obj.selfReviewNote === 'string' && obj.selfReviewNote.trim()
      ? obj.selfReviewNote.trim()
      : undefined;
  const selectionRationale =
    typeof obj.selectionRationale === 'string' && obj.selectionRationale.trim()
      ? obj.selectionRationale.trim()
      : undefined;

  const candidateSolutions: AiCandidateOption[] = [];
  if (Array.isArray(obj.candidateSolutions)) {
    for (const rawOption of obj.candidateSolutions) {
      if (!rawOption || typeof rawOption !== 'object') continue;
      const opt = rawOption as Record<string, unknown>;
      const approach = typeof opt.approach === 'string' ? opt.approach.trim() : '';
      const critique = typeof opt.critique === 'string' ? opt.critique.trim() : '';
      if (approach) {
        candidateSolutions.push({
          approach,
          critique: critique || 'Evaluated against runtime compatibility constraints.',
          selected: Boolean(opt.selected),
        });
      }
    }
  }

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
    diagnosis,
    candidateSolutions: candidateSolutions.length > 0 ? candidateSolutions : undefined,
    selfReviewNote,
    selectionRationale,
    technologies,
    dependencies,
    operations,
    assistantSummary,
  };
}

export function buildWorkspaceContextPrompt(params: {
  userPrompt: string;
  projectName: string;
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  files: SceneFile[];
  auditReport?: WorkspaceAuditReport;
  researchSummary?: string;
  diagnostics?: RuntimeDiagnostic[];
  repairAttempt?: number;
  repairHistory?: RepairAttemptRecord[];
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

  const auditSection =
    params.auditReport && params.auditReport.issues.length > 0
      ? [
          `PRE-FLIGHT STATIC WORKSPACE AUDIT (${params.auditReport.summary}):`,
          ...params.auditReport.issues.map(
            (issue, idx) =>
              `${idx + 1}. [${issue.severity.toUpperCase()}]${issue.file ? ` (${issue.file})` : ''} ${issue.message} → Suggestion: ${issue.suggestion}`
          ),
        ].join('\n')
      : params.auditReport && params.files.length > 0
        ? `PRE-FLIGHT STATIC WORKSPACE AUDIT: ${params.auditReport.summary}`
        : '';

  const researchSection = params.researchSummary
    ? `WEB RESEARCH & COMPATIBILITY FINDINGS:\n${params.researchSummary}`
    : '';

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

  const historySection =
    params.repairHistory && params.repairHistory.length > 0
      ? [
          'PREVIOUS FAILED REPAIR ATTEMPTS (DO NOT REPEAT THESE APPROACHES):',
          ...params.repairHistory.map(
            (item) =>
              `- Attempt ${item.attempt}: Tried "${item.planTried}" (${item.filesTouched.join(', ') || 'no files'}) -> Failed with: ${item.errorSummary}`
          ),
          'CRITICAL: Analyze why the previous attempt(s) failed, critique that root cause, and implement a genuinely different, cleaner fix.',
        ].join('\n')
      : '';

  return [
    `PROJECT: "${params.projectName}"`,
    `TARGET VIEWPORT: ${params.aspectRatio} (${spec.resolution}) @ ${params.frameRate} fps`,
    '',
    fileSection,
    auditSection ? `\n${auditSection}\n` : '',
    researchSection ? `\n${researchSection}\n` : '',
    diagSection ? `\n${diagSection}\n` : '',
    historySection ? `\n${historySection}\n` : '',
    params.repairAttempt
      ? `TASK: Fix all compile/runtime errors listed above without repeating failed approaches, while fulfilling the user's request: "${params.userPrompt}"`
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

function mergeWebSources(existing: AiWebSource[], incoming: AiWebSource[]): AiWebSource[] {
  const seen = new Set(existing.map((s) => s.url));
  const merged = [...existing];
  for (const src of incoming) {
    if (!seen.has(src.url)) {
      seen.add(src.url);
      merged.push(src);
    }
  }
  return merged;
}

async function performWebCompatibilityResearch(params: {
  provider: AiProviderConfig;
  userPrompt: string;
  audit: WorkspaceAuditReport;
  diagnostics?: RuntimeDiagnostic[];
  signal?: AbortSignal;
}): Promise<{
  attempted: boolean;
  summary?: string;
  sources: AiWebSource[];
  note: string;
}> {
  if (params.provider.kind !== 'gemini') {
    return {
      attempted: false,
      sources: [],
      note: 'Live web grounding skipped (supported on Google Gemini providers).',
    };
  }

  const issueLines = params.audit.issues.map((i) => `- ${i.message}`).join('\n');
  const errorLines = (params.diagnostics ?? []).map((d) => `- [${d.type}] ${d.message}`).join('\n');
  const depLine = params.audit.externalDependencies.join(', ');

  const researchPrompt = [
    'Verify browser ESM (esm.sh), React 19.1.0, Three.js / GSAP / Web API compatibility and known pitfalls relevant to this task.',
    `Task: ${params.userPrompt}`,
    depLine ? `Detected dependencies: ${depLine}` : '',
    issueLines ? `Static audit findings:\n${issueLines}` : '',
    errorLines ? `Observed runtime/compile errors:\n${errorLines}` : '',
    'Provide a concise 4-6 bullet factual technical brief covering exact package imports, API signatures, or compatibility fixes needed. Only state verified facts.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const res = await generateProviderCompletionDetailed(
      providerWithFallback(params.provider),
      {
        systemPrompt:
          'You are a technical research assistant verifying official web library APIs, ESM CDN imports, and browser compatibility using live web search.',
        messages: [{ role: 'user', content: researchPrompt }],
        temperature: 0.2,
        maxTokens: 1200,
        expectJson: false,
        enableWebSearch: true,
        signal: params.signal,
      }
    );

    return {
      attempted: true,
      summary: res.text,
      sources: res.webSources,
      note:
        res.webSources.length > 0
          ? `Verified ${res.webSources.length} web ${res.webSources.length === 1 ? 'source' : 'sources'}`
          : 'Completed web check (no external citations attached by model)',
    };
  } catch (err) {
    // Grounding tools may not be enabled on every Gemini model; degrade cleanly without aborting turn
    const reason = err instanceof Error ? err.message : 'Web search unavailable for selected model.';
    return {
      attempted: false,
      sources: [],
      note: `Web grounding unavailable for ${params.provider.model}: ${reason}`,
    };
  }
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
  let collectedSources: AiWebSource[] = [];
  let cachedResearchSummary: string | undefined;

  try {
    // 1. Analyze request
    params.onStatusChange('planning');
    pushStep('analyze', 'Analyzing scene request', 'done', `${params.aspectRatio} · ${params.frameRate} fps`);

    // 2. Inspect existing files + autonomous workspace audit
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

    const initialAudit = auditSceneWorkspace(workingFiles);
    const useDeepReview = detectDiagnosticIntent(params.userPrompt, workingFiles, initialAudit);

    if (useDeepReview) {
      params.onStatusChange('diagnosing');
      pushStep(
        'diagnose',
        initialAudit.issues.length > 0
          ? `Discovered ${initialAudit.issues.length} workspace ${initialAudit.issues.length === 1 ? 'issue' : 'issues'}`
          : 'Completed pre-flight architecture & dependency check',
        initialAudit.issues.some((i) => i.severity === 'error') ? 'error' : 'done',
        initialAudit.summary
      );
    }

    // 3. Optional real web research stage when diagnosing/compatibility needs verification
    if (useDeepReview && shouldUseWebResearch(params.userPrompt, workingFiles, initialAudit)) {
      params.onStatusChange('researching');
      pushStep('research', 'Checking live documentation & library compatibility', 'running');
      const research = await performWebCompatibilityResearch({
        provider: params.provider,
        userPrompt: params.userPrompt,
        audit: initialAudit,
        signal: params.signal,
      });
      if (research.summary) {
        cachedResearchSummary = research.summary;
      }
      if (research.sources.length > 0) {
        collectedSources = mergeWebSources(collectedSources, research.sources);
        run = { ...run, webSources: collectedSources };
      }
      pushStep(
        'research',
        research.attempted ? 'Completed web compatibility check' : 'Skipped live web search',
        research.attempted ? 'done' : 'skipped',
        research.note
      );
    }

    // 4. Plan, self-review (if deep mode), & generate code from AI provider
    params.onStatusChange(useDeepReview ? 'reviewing' : 'thinking');
    pushStep(
      'plan',
      useDeepReview
        ? `Diagnosing root cause & evaluating solutions via ${params.provider.model}`
        : `Planning & generating code via ${params.provider.model}`,
      'running'
    );

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
      auditReport: initialAudit,
      researchSummary: cachedResearchSummary,
    });

    const completion = await generateProviderCompletionDetailed(providerWithFallback(params.provider), {
      systemPrompt: useDeepReview ? DEEP_REVIEW_SYSTEM_PROMPT : SYSTEM_PROMPT,
      messages: [...recentMessages, { role: 'user', content: contextPrompt }],
      expectJson: true,
      signal: params.signal,
    });

    const aiOutput = parseAiBrainResponse(completion.text);
    lastSummary = aiOutput.assistantSummary;
    run = {
      ...run,
      technologies: aiOutput.technologies,
      diagnosis: aiOutput.diagnosis ?? run.diagnosis,
      alternativesConsidered: aiOutput.candidateSolutions ?? run.alternativesConsidered,
      selfReviewNote: aiOutput.selfReviewNote ?? run.selfReviewNote,
      selectionRationale: aiOutput.selectionRationale ?? run.selectionRationale,
    };

    pushStep(
      'plan',
      'Planned architecture & generated scene code',
      'done',
      [aiOutput.plan, aiOutput.technologies.length ? `Stack: ${aiOutput.technologies.join(', ')}` : '']
        .filter(Boolean)
        .join(' · ')
    );

    if (useDeepReview && (aiOutput.candidateSolutions || aiOutput.selfReviewNote || aiOutput.diagnosis)) {
      pushStep(
        'self-review',
        `Evaluated ${aiOutput.candidateSolutions?.length ?? 1} solution ${(aiOutput.candidateSolutions?.length ?? 1) === 1 ? 'path' : 'paths'} & self-reviewed`,
        'done',
        aiOutput.selectionRationale || aiOutput.selfReviewNote || aiOutput.diagnosis
      );
    }

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
      pushStep('files', 'No file changes needed', 'skipped');
    }

    // 5. Compile -> live runtime verification -> non-repeating adaptive repair loop
    let activeDiagnostics: RuntimeDiagnostic[] = [];
    const repairHistory: RepairAttemptRecord[] = [];
    let lastPlanForRepair = aiOutput.plan;
    let lastTouchedForRepair = [
      ...run.createdFiles,
      ...run.modifiedFiles,
      ...run.deletedFiles,
    ];

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

      // Trigger adaptive non-repeating repair if attempts remain
      if (attempt < MAX_REPAIR_ATTEMPTS) {
        const repairNum = attempt + 1;
        const errSummary = activeDiagnostics.map((d) => d.message).join(' | ');

        repairHistory.push({
          attempt: attempt === 0 ? 0 : attempt,
          errorSummary: errSummary,
          planTried: lastPlanForRepair,
          filesTouched: lastTouchedForRepair,
        });

        run = { ...run, repairAttempts: repairNum };
        params.onStatusChange('repairing');
        pushStep(
          'repair',
          `Diagnosing failure for repair attempt ${repairNum}/${MAX_REPAIR_ATTEMPTS}`,
          'running',
          activeDiagnostics[0]?.message
        );

        const currentAudit = auditSceneWorkspace(workingFiles);

        // If Gemini and first repair fails on external/API/runtime issue without prior research, verify docs via web search
        if (
          repairNum === 1 &&
          !cachedResearchSummary &&
          params.provider.kind === 'gemini'
        ) {
          params.onStatusChange('researching');
          const repairResearch = await performWebCompatibilityResearch({
            provider: params.provider,
            userPrompt: params.userPrompt,
            audit: currentAudit,
            diagnostics: activeDiagnostics,
            signal: params.signal,
          });
          if (repairResearch.summary) {
            cachedResearchSummary = repairResearch.summary;
          }
          if (repairResearch.sources.length > 0) {
            collectedSources = mergeWebSources(collectedSources, repairResearch.sources);
            run = { ...run, webSources: collectedSources };
          }
          params.onStatusChange('repairing');
        }

        const repairPrompt = buildWorkspaceContextPrompt({
          userPrompt: params.userPrompt,
          projectName: params.projectName,
          aspectRatio: params.aspectRatio,
          frameRate: params.frameRate,
          files: workingFiles,
          auditReport: currentAudit,
          researchSummary: cachedResearchSummary,
          diagnostics: activeDiagnostics,
          repairAttempt: repairNum,
          repairHistory,
        });

        const repairCompletion = await generateProviderCompletionDetailed(
          providerWithFallback(params.provider),
          {
            systemPrompt: DEEP_REVIEW_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: repairPrompt }],
            expectJson: true,
            signal: params.signal,
          }
        );

        const repairOut = parseAiBrainResponse(repairCompletion.text);
        run = {
          ...run,
          diagnosis: repairOut.diagnosis ?? run.diagnosis,
          alternativesConsidered: repairOut.candidateSolutions ?? run.alternativesConsidered,
          selfReviewNote: repairOut.selfReviewNote ?? run.selfReviewNote,
          selectionRationale: repairOut.selectionRationale ?? run.selectionRationale,
        };

        if (repairOut.operations.length > 0) {
          const appliedRepair = applyFileOperations(workingFiles, repairOut.operations);
          workingFiles = appliedRepair.files;
          primaryTouchedPath =
            appliedRepair.primaryTouchedPath ?? primaryTouchedPath ?? workingFiles[0]?.path ?? null;
          appliedRepair.created.forEach((p) => createdTotal.add(p));
          appliedRepair.modified.forEach((p) => modifiedTotal.add(p));
          appliedRepair.deleted.forEach((p) => deletedTotal.add(p));
          lastPlanForRepair = repairOut.plan;
          lastTouchedForRepair = [
            ...appliedRepair.created,
            ...appliedRepair.modified,
            ...appliedRepair.deleted,
          ];
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
            `Applied alternative repair ${repairNum}/${MAX_REPAIR_ATTEMPTS}`,
            'done',
            repairOut.selectionRationale || repairOut.plan
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
