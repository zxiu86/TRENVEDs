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
  normalizeScenePath,
  resolveRelativeModulePath,
} from './sceneFiles';
import { compileSceneBundle, resolveExternalPackageUrl } from '../runtime/sceneBundler';
import {
  classifyProviderError,
  maskApiKey,
  validateProviderBaseUrl,
} from '../services/aiProviders';
import { parseAiBrainResponse } from '../services/aiBrain';
import type { SceneFile, StudioSettings } from '../types/studio';

const defaultSettings: StudioSettings = {
  defaultAspectRatio: '16:9',
  defaultFrameRate: 24,
  showGuidesByDefault: true,
  showLineNumbers: true,
};

test('createLocalProject initializes V1.2 project with empty files and activityRuns', () => {
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

test('compileSceneBundle compiles React TSX multi-file project with importmap and diagnostics bridge', () => {
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
});

test('compileSceneBundle reports unresolved relative imports cleanly', () => {
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
});

test('resolveExternalPackageUrl rejects unsafe or malformed specifiers and pins react', () => {
  assert.match(resolveExternalPackageUrl('react-dom/client').url ?? '', /deps=react@19\.1\.0/);
  assert.equal(resolveExternalPackageUrl('gsap').url, 'https://esm.sh/gsap@3.12.7');
  assert.equal(resolveExternalPackageUrl('javascript:alert(1)').url, null);
});

test('aiProviders helpers mask keys, validate endpoint URLs, and classify errors honestly', () => {
  assert.equal(maskApiKey('AIzaSyA1234567890XYZW'), 'AIza••••••XYZW');
  assert.equal(maskApiKey('short'), '••••••••');
  assert.equal(validateProviderBaseUrl('https://generativelanguage.googleapis.com/v1beta').valid, true);
  assert.equal(validateProviderBaseUrl('http://localhost:11434/v1').valid, true);
  assert.equal(validateProviderBaseUrl('http://example.com/v1').valid, false);
  assert.equal(validateProviderBaseUrl('javascript:alert(1)').valid, false);

  assert.match(classifyProviderError(401, '{}', 'openai'), /Invalid or unauthorized API key/);
  assert.match(classifyProviderError(429, '{}', 'gemini'), /Rate limit or quota exceeded/);
  assert.match(classifyProviderError(404, '{"error":{"message":"Model missing"}}', 'gemini'), /Model missing/);
});

test('parseAiBrainResponse extracts fenced JSON and normalizes operations', () => {
  const raw = '```json\n{"plan":"Create crimson reveal","technologies":["HTML","CSS"],"dependencies":[],"operations":[{"type":"create","path":"./index.html","content":"<h1>Hi</h1>"}],"assistantSummary":"Created reveal."}\n```';
  const parsed = parseAiBrainResponse(raw);
  assert.equal(parsed.plan, 'Create crimson reveal');
  assert.deepEqual(parsed.technologies, ['HTML', 'CSS']);
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].path, 'index.html');
});
