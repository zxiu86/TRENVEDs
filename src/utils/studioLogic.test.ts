import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateContainedFrameSize,
  clampPanelWidth,
  clampZoom,
  createLocalProject,
  detectLanguageFromFilename,
  getAspectRatioSpec,
  sanitizeProjectName,
} from './studioLogic';
import {
  applyFileOperations,
  detectSceneEntryFile,
  extractSceneExternalDependencies,
  inferFilenameFromCode,
  normalizeScenePath,
  resolveImportConflictName,
  resolveRelativeModulePath,
  validateImportedFile,
} from './sceneFiles';
import { auditSceneWorkspace, detectDiagnosticIntent, shouldUseWebResearch } from './sceneDiagnostics';
import { compileSceneBundle, resolveExternalPackageUrl } from '../runtime/sceneBundler';
import {
  classifyProviderError,
  discoverProviderModels,
  generateProviderCompletionDetailed,
  maskApiKey,
  resolveProviderBaseUrl,
  validateProviderBaseUrl,
} from '../services/aiProviders';
import { buildWorkspaceContextPrompt, parseAiBrainResponse } from '../services/aiBrain';
import type { SceneFile, StudioSettings } from '../types/studio';

const defaultSettings: StudioSettings = {
  defaultAspectRatio: '16:9',
  defaultFrameRate: 24,
  showGuidesByDefault: true,
  showLineNumbers: true,
};

test('createLocalProject initializes project with empty files and activityRuns', () => {
  const project = createLocalProject(defaultSettings, 0, '2026-11-26T10:00:00.000Z');
  assert.equal(project.name, 'Untitled Sequence 01');
  assert.equal(project.aspectRatio, '16:9');
  assert.equal(project.frameRate, 24);
  assert.deepEqual(project.messages, []);
  assert.deepEqual(project.files, []);
  assert.equal(project.activeFilePath, null);
  assert.deepEqual(project.activityRuns, []);
});

test('sanitizeProjectName trims whitespace, handles empty input, and bounds length', () => {
  assert.equal(sanitizeProjectName('   Main   Title  '), 'Main Title');
  assert.equal(sanitizeProjectName('   ', 'Fallback Name'), 'Fallback Name');
  assert.equal(sanitizeProjectName('A'.repeat(100)).length, 64);
});

test('clampZoom bounds viewport zoom between 25% and 200%', () => {
  assert.equal(clampZoom(10), 25);
  assert.equal(clampZoom(250), 200);
  assert.equal(clampZoom(75.4), 75);
  assert.equal(clampZoom(Number.NaN), 100);
});

test('clampPanelWidth enforces min and max bounds', () => {
  assert.equal(clampPanelWidth(150, 260, 480), 260);
  assert.equal(clampPanelWidth(620, 260, 480), 480);
  assert.equal(clampPanelWidth(340, 260, 480), 340);
});

test('getAspectRatioSpec returns accurate frame metadata', () => {
  const vertical = getAspectRatioSpec('9:16');
  assert.equal(vertical.resolution, '1080 × 1920');
  assert.equal(vertical.widthRatio, 9);
  assert.equal(vertical.heightRatio, 16);
});

test('calculateContainedFrameSize keeps 9:16 portrait strictly 9:16 inside landscape workspace', () => {
  const portraitInLandscape = calculateContainedFrameSize(800, 640, '9:16', 100, true);
  assert.equal(portraitInLandscape.height, 640);
  assert.equal(portraitInLandscape.width, 360);
  assert.ok(portraitInLandscape.width < portraitInLandscape.height);
  assert.ok(Math.abs(portraitInLandscape.width / portraitInLandscape.height - 9 / 16) < 0.01);
});

test('calculateContainedFrameSize keeps 16:9, 1:1, and zoomed frames strictly proportional', () => {
  const landscapeInPortrait = calculateContainedFrameSize(360, 640, '16:9', 100, true);
  assert.equal(landscapeInPortrait.width, 360);
  assert.equal(landscapeInPortrait.height, 203);

  const square = calculateContainedFrameSize(800, 500, '1:1', 100, true);
  assert.equal(square.width, 500);
  assert.equal(square.height, 500);

  const zoomed = calculateContainedFrameSize(800, 640, '9:16', 150, false);
  assert.equal(zoomed.width, 540);
  assert.equal(zoomed.height, 960);
});

test('detectLanguageFromFilename maps extensions dynamically', () => {
  assert.deepEqual(detectLanguageFromFilename('stage.html'), { id: 'html', label: 'HTML' });
  assert.deepEqual(detectLanguageFromFilename('glass-rim.css'), { id: 'css', label: 'CSS' });
  assert.deepEqual(detectLanguageFromFilename('motion.cue.js'), { id: 'javascript', label: 'JavaScript' });
  assert.deepEqual(detectLanguageFromFilename('scene.script.ts'), { id: 'typescript', label: 'TypeScript' });
  assert.deepEqual(detectLanguageFromFilename('BadgeCard.jsx'), { id: 'jsx', label: 'JSX' });
  assert.deepEqual(detectLanguageFromFilename('TitleOverlay.tsx'), { id: 'tsx', label: 'TSX' });
  assert.deepEqual(detectLanguageFromFilename('lighting.preset.json'), { id: 'json', label: 'JSON' });
  assert.deepEqual(detectLanguageFromFilename('aperture.svg'), { id: 'svg', label: 'SVG / XML' });
  assert.deepEqual(detectLanguageFromFilename('notes.txt'), { id: 'plaintext', label: 'Plain Text' });
});

test('normalizeScenePath and applyFileOperations handle create, update, rename, delete cleanly', () => {
  assert.equal(normalizeScenePath('./src//components/../App.tsx'), 'src/App.tsx');

  const step1 = applyFileOperations([], [
    { type: 'create', path: './index.html', content: '<h1>V1</h1>' },
    { type: 'create', path: 'styles.css', content: 'body { color: white; }' },
    { type: 'create', path: 'temp.js', content: 'console.log(1);' },
  ]);
  assert.deepEqual(step1.created, ['index.html', 'styles.css', 'temp.js']);
  assert.equal(step1.files.length, 3);

  const step2 = applyFileOperations(step1.files, [
    { type: 'update', path: 'index.html', content: '<h1>V2</h1>' },
    { type: 'rename', path: 'temp.js', newPath: 'main.js' },
    { type: 'delete', path: 'styles.css' },
  ]);
  assert.deepEqual(step2.modified, ['index.html']);
  assert.deepEqual(step2.deleted, ['temp.js', 'styles.css']);
  assert.deepEqual(step2.created, ['main.js']);
  assert.equal(step2.files.find((f) => f.path === 'index.html')?.content, '<h1>V2</h1>');
  assert.equal(step2.files.some((f) => f.path === 'styles.css'), false);
});

test('detectSceneEntryFile and resolveRelativeModulePath resolve multi-file graphs', () => {
  const files: SceneFile[] = [
    { path: 'src/components/Monolith.tsx', content: 'export const Monolith = () => <div />;', updatedAt: '' },
    { path: 'src/App.tsx', content: 'import { Monolith } from "./components/Monolith"; export default function App() { return <Monolith />; }', updatedAt: '' },
    { path: 'src/styles.css', content: 'body { background: #060608; }', updatedAt: '' },
  ];
  assert.equal(detectSceneEntryFile(files)?.path, 'src/App.tsx');
  assert.equal(
    resolveRelativeModulePath('src/App.tsx', './components/Monolith', files)?.path,
    'src/components/Monolith.tsx'
  );
  const deps = extractSceneExternalDependencies(files);
  assert.ok(deps.includes('react'));
  assert.ok(deps.includes('react-dom/client'));
});

test('validateImportedFile inspects both extension and content, rejecting binaries and oversized files', () => {
  assert.equal(validateImportedFile('scene.tsx', 'export default function App() { return <div />; }').valid, true);
  assert.equal(validateImportedFile('notes.txt', 'hello world').valid, true);

  const unsupported = validateImportedFile('movie.mp4', 'data');
  assert.equal(unsupported.valid, false);
  assert.match(unsupported.error ?? '', /Unsupported file type/);

  const binaryDisguised = validateImportedFile('fake.js', '%PDF-1.4\u0000binary');
  assert.equal(binaryDisguised.valid, false);
  assert.match(binaryDisguised.error ?? '', /binary/);

  const brokenJson = validateImportedFile('preset.json', '{ invalid');
  assert.equal(brokenJson.valid, true);
  assert.match(brokenJson.warning ?? '', /JSON syntax issue/);
});

test('resolveImportConflictName and inferFilenameFromCode handle collisions and pasted code languages cleanly', () => {
  const existing: SceneFile[] = [
    { path: 'index.html', content: '<h1>1</h1>', updatedAt: '' },
    { path: 'src/App.tsx', content: 'export default function App() { return <div />; }', updatedAt: '' },
  ];
  assert.equal(resolveImportConflictName(existing, 'index.html'), 'index (2).html');
  assert.equal(resolveImportConflictName(existing, 'src/App.tsx'), 'src/App (2).tsx');

  assert.equal(
    inferFilenameFromCode('<!doctype html><html><body>Hi</body></html>', existing),
    'index (2).html'
  );
  assert.equal(
    inferFilenameFromCode('import React from "react"; export default function Scene() { return <div />; }', []),
    'App.jsx'
  );
  assert.equal(
    inferFilenameFromCode('interface Props { label: string }\nexport default function Scene({ label }: Props) { return <div>{label}</div>; }', []),
    'App.tsx'
  );
  assert.equal(
    inferFilenameFromCode('body { background: #000; color: #fff; display: flex; }', []),
    'styles.css'
  );
  assert.equal(
    inferFilenameFromCode('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20" /></svg>', []),
    'graphic.svg'
  );
});

test('compileSceneBundle compiles React TSX multi-file project and inline HTML babel/tsx scripts', () => {
  const files: SceneFile[] = [
    {
      path: 'src/Card.tsx',
      content: 'export function Card({ title }: { title: string }) { return <div className="card">{title}</div>; }',
      updatedAt: '',
    },
    {
      path: 'src/App.tsx',
      content: 'import React from "react";\nimport "./card.css";\nimport gsap from "gsap";\nimport { Card } from "./Card";\nexport default function App() { void gsap; return <Card title="TRENVEDs" />; }',
      updatedAt: '',
    },
    {
      path: 'src/card.css',
      content: '.card { color: #dc2626; }',
      updatedAt: '',
    },
  ];

  const bundle = compileSceneBundle(files, { runId: 'test_run_1' });
  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.entryPath, 'src/App.tsx');
  assert.match(bundle.html, /<script type="importmap">/);
  assert.match(bundle.html, /@trenveds\/src\/Card\.tsx":\s*"data:text\/javascript/);
  assert.match(bundle.html, /@trenveds\/src\/card\.css":\s*"data:text\/javascript/);
  assert.doesNotMatch(bundle.html, /esm\.sh\/@trenveds/);
  assert.doesNotMatch(bundle.html, /%22\.%2Fcard\.css%22/);
  assert.match(bundle.html, /https:\/\/esm\.sh\/gsap/);
  assert.match(bundle.html, /trenveds-runtime/);

  const singleHtmlBundle = compileSceneBundle([
    {
      path: 'index.html',
      content:
        '<!doctype html><html><body><div id="app"></div><script type="text/tsx">const title: string = "V1.3"; document.getElementById("app")!.textContent = title;</script></body></html>',
      updatedAt: '',
    },
  ]);
  assert.equal(singleHtmlBundle.diagnostics.length, 0);
  assert.match(singleHtmlBundle.html, /<script type="module" src="data:text\/javascript/);
});

test('compileSceneBundle reports unresolved relative imports and missing HTML stylesheets cleanly', () => {
  const files: SceneFile[] = [
    {
      path: 'main.ts',
      content: 'import { missing } from "./does-not-exist"; console.log(missing);',
      updatedAt: '',
    },
  ];
  const bundle = compileSceneBundle(files);
  assert.equal(bundle.diagnostics.length, 1);
  assert.equal(bundle.diagnostics[0].type, 'compile-error');
  assert.match(bundle.diagnostics[0].message, /does-not-exist/);

  const htmlMissingCss = compileSceneBundle([
    {
      path: 'index.html',
      content: '<html><head><link rel="stylesheet" href="./missing.css" /></head><body>Hi</body></html>',
      updatedAt: '',
    },
  ]);
  assert.equal(htmlMissingCss.diagnostics.length, 1);
  assert.match(htmlMissingCss.diagnostics[0].message, /missing\.css/);
});

test('auditSceneWorkspace autonomously finds hidden bugs and routes diagnostic/research intent', () => {
  const brokenFiles: SceneFile[] = [
    {
      path: 'index.html',
      content: '<html><body><h1>Old static page</h1></body></html>',
      updatedAt: '',
    },
    {
      path: 'src/App.tsx',
      content: 'import { Ring } from "./Ring"; export function Helper() { return <Ring />; }',
      updatedAt: '',
    },
    {
      path: 'widget.js',
      content: 'export function Widget() { return <div className="box">JSX in .js</div>; }',
      updatedAt: '',
    },
  ];

  const audit = auditSceneWorkspace(brokenFiles);
  assert.ok(audit.issues.some((i) => i.id === 'stale-html-shadowing'));
  assert.ok(audit.issues.some((i) => i.id.startsWith('missing-import-src/App.tsx')));
  assert.ok(audit.issues.some((i) => i.id.startsWith('jsx-in-js-widget.js')));

  assert.equal(detectDiagnosticIntent('Create a crimson title', [], auditSceneWorkspace([])), false);
  assert.equal(detectDiagnosticIntent('Why is my scene broken?', [], auditSceneWorkspace([])), true);
  assert.equal(detectDiagnosticIntent('Update text', brokenFiles, audit), true);
  assert.equal(
    shouldUseWebResearch('Fix Three.js WebGL shader compatibility issue', brokenFiles, audit),
    true
  );
});

test('resolveExternalPackageUrl rejects unsafe or malformed specifiers and pins react', () => {
  assert.match(resolveExternalPackageUrl('react-dom/client').url ?? '', /deps=react@19\.1\.0/);
  assert.equal(resolveExternalPackageUrl('gsap').url, 'https://esm.sh/gsap@3.12.7');
  assert.equal(resolveExternalPackageUrl('javascript:alert(1)').url, null);
});

test('aiProviders helpers mask keys, resolve official endpoints, validate custom URLs, and extract Gemini web sources', async () => {
  assert.equal(maskApiKey('AIzaSyA1234567890XYZW'), 'AIza••••••XYZW');
  assert.equal(maskApiKey('short'), '••••••••');

  assert.equal(
    resolveProviderBaseUrl({ kind: 'gemini', baseUrl: '' }),
    'https://generativelanguage.googleapis.com/v1beta'
  );
  assert.equal(
    resolveProviderBaseUrl({ kind: 'openai', baseUrl: 'https://custom.invalid' }),
    'https://api.openai.com/v1'
  );
  assert.equal(
    resolveProviderBaseUrl({ kind: 'anthropic', baseUrl: '' }),
    'https://api.anthropic.com/v1'
  );
  assert.equal(
    resolveProviderBaseUrl({ kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1/' }),
    'https://openrouter.ai/api/v1'
  );

  assert.equal(validateProviderBaseUrl('https://generativelanguage.googleapis.com/v1beta').valid, true);
  assert.equal(validateProviderBaseUrl('http://localhost:11434/v1').valid, true);
  assert.equal(validateProviderBaseUrl('http://example.com/v1').valid, false);
  assert.equal(validateProviderBaseUrl('javascript:alert(1)').valid, false);

  assert.match(classifyProviderError(401, '{}', 'openai'), /Invalid or unauthorized API key/);
  assert.match(classifyProviderError(429, '{}', 'gemini'), /Rate limit or quota exceeded/);
  assert.match(classifyProviderError(404, '{"error":{"message":"Model missing"}}', 'gemini'), /Model missing/);
  assert.match(
    classifyProviderError(400, '{"error":{"message":"Model gpt-99 does not exist"}}', 'openai'),
    /Unsupported or unavailable model/
  );

  let capturedBody: Record<string, unknown> = {};
  const mockGeminiSearchFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'Three.js 0.170 works cleanly with OrbitControls.' }] },
            groundingMetadata: {
              webSearchQueries: ['three 0.170 esm.sh OrbitControls'],
              groundingChunks: [
                { web: { uri: 'https://threejs.org/docs/', title: 'Three.js Docs' } },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    );
  };

  const searchResult = await generateProviderCompletionDetailed(
    {
      id: 'p1',
      name: 'Gemini',
      kind: 'gemini',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'AIzaTestKey12345',
      persistence: 'session',
      discoveredModels: [],
      lastTestStatus: 'untested',
    },
    {
      systemPrompt: 'Verify library APIs',
      messages: [{ role: 'user', content: 'Check Three.js OrbitControls' }],
      expectJson: true,
      enableWebSearch: true,
    },
    mockGeminiSearchFetch
  );

  assert.deepEqual(capturedBody.tools, [{ google_search: {} }]);
  assert.equal((capturedBody.generationConfig as Record<string, unknown>).responseMimeType, undefined);
  assert.equal(searchResult.webSources.length, 1);
  assert.equal(searchResult.webSources[0].url, 'https://threejs.org/docs/');
});

test('discoverProviderModels retrieves full untruncated paginated lists across Gemini, OpenAI, and Anthropic', async () => {
  const geminiUrls: string[] = [];
  const geminiFetch: typeof fetch = async (input) => {
    const url = String(input);
    geminiUrls.push(url);
    if (!url.includes('pageToken=')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'page2',
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
      { status: 200 }
    );
  };

  const geminiResult = await discoverProviderModels(
    { kind: 'gemini', baseUrl: '', apiKey: 'AIzaTestKey12345' },
    geminiFetch
  );
  assert.equal(geminiUrls.length, 2);
  assert.ok(geminiUrls[0].startsWith('https://generativelanguage.googleapis.com/v1beta/models'));
  assert.deepEqual(geminiResult.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);

  const openAiItems = Array.from({ length: 85 }, (_, idx) => ({
    id: `model-${String(idx + 1).padStart(3, '0')}`,
  }));
  const openAiFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ data: openAiItems }), { status: 200 });
  const openAiResult = await discoverProviderModels(
    { kind: 'openai', baseUrl: '', apiKey: 'sk-test-123456' },
    openAiFetch
  );
  assert.equal(openAiResult.models.length, 85);

  const anthropicFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (!url.includes('after_id=')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514' }],
          has_more: true,
          last_id: 'claude-sonnet-4-20250514',
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        data: [{ id: 'claude-3-5-haiku-20241022' }],
        has_more: false,
      }),
      { status: 200 }
    );
  };
  const anthropicResult = await discoverProviderModels(
    { kind: 'anthropic', baseUrl: '', apiKey: 'sk-ant-test-123456' },
    anthropicFetch
  );
  assert.deepEqual(anthropicResult.models, [
    'claude-sonnet-4-20250514',
    'claude-3-5-haiku-20241022',
  ]);

  const abortController = new AbortController();
  abortController.abort();
  const abortedResult = await discoverProviderModels(
    { kind: 'openai', baseUrl: '', apiKey: 'sk-test-123456' },
    openAiFetch,
    abortController.signal
  );
  assert.equal(abortedResult.aborted, true);
  assert.deepEqual(abortedResult.models, []);
});

test('parseAiBrainResponse and buildWorkspaceContextPrompt preserve deep diagnosis, candidate critiques, and repair history', () => {
  const raw = '```json\n{"diagnosis":"Stale index.html shadows App.tsx","candidateSolutions":[{"approach":"Patch HTML","critique":"Leaves legacy DOM conflicts","selected":false},{"approach":"Delete stale index.html","critique":"Cleanly runs React TSX entry","selected":true}],"selfReviewNote":"Verified React 19 export default","selectionRationale":"Safest root fix","plan":"Remove stale index.html","technologies":["React","TSX"],"dependencies":["react"],"operations":[{"type":"delete","path":"./index.html"}],"assistantSummary":"Removed stale index.html."}\n```';
  const parsed = parseAiBrainResponse(raw);
  assert.equal(parsed.diagnosis, 'Stale index.html shadows App.tsx');
  assert.equal(parsed.candidateSolutions?.length, 2);
  assert.equal(parsed.candidateSolutions?.[1].selected, true);
  assert.equal(parsed.selfReviewNote, 'Verified React 19 export default');
  assert.equal(parsed.operations[0].type, 'delete');

  const repairContext = buildWorkspaceContextPrompt({
    userPrompt: 'Fix the broken scene',
    projectName: 'Demo',
    aspectRatio: '16:9',
    frameRate: 24,
    files: [{ path: 'App.tsx', content: 'export default function App() { return <div />; }', updatedAt: '' }],
    repairAttempt: 2,
    repairHistory: [
      {
        attempt: 1,
        errorSummary: 'Unresolved import ./Ring',
        planTried: 'Renamed Ring.js to Ring.jsx',
        filesTouched: ['Ring.jsx'],
      },
    ],
  });
  assert.match(repairContext, /PREVIOUS FAILED REPAIR ATTEMPTS \(DO NOT REPEAT THESE APPROACHES\)/);
  assert.match(repairContext, /Renamed Ring\.js to Ring\.jsx/);
});
