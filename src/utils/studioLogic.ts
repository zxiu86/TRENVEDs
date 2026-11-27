import type {
  AspectRatio,
  CodeLanguage,
  Project,
  StudioSettings,
} from '../types/studio';

export interface AspectRatioSpec {
  id: AspectRatio;
  label: string;
  resolution: string;
  widthRatio: number;
  heightRatio: number;
}

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface DetectedLanguage {
  id: CodeLanguage;
  label: string;
}

export const ASPECT_RATIO_SPECS: Record<AspectRatio, AspectRatioSpec> = {
  '16:9': {
    id: '16:9',
    label: 'Widescreen',
    resolution: '1920 × 1080',
    widthRatio: 16,
    heightRatio: 9,
  },
  '9:16': {
    id: '9:16',
    label: 'Vertical',
    resolution: '1080 × 1920',
    widthRatio: 9,
    heightRatio: 16,
  },
  '1:1': {
    id: '1:1',
    label: 'Square',
    resolution: '1080 × 1080',
    widthRatio: 1,
    heightRatio: 1,
  },
  '4:3': {
    id: '4:3',
    label: 'Classic',
    resolution: '1440 × 1080',
    widthRatio: 4,
    heightRatio: 3,
  },
};

export function getAspectRatioSpec(aspectRatio: AspectRatio): AspectRatioSpec {
  return ASPECT_RATIO_SPECS[aspectRatio];
}

/**
 * Calculates exact pixel dimensions for a video frame contained inside an available stage.
 * Guarantees the selected aspect ratio is never stretched or distorted in any orientation.
 */
export function calculateContainedFrameSize(
  availableWidth: number,
  availableHeight: number,
  aspectRatio: AspectRatio,
  zoomPercent: number,
  isFitMode: boolean
): FrameDimensions {
  const spec = getAspectRatioSpec(aspectRatio);
  const targetRatio = spec.widthRatio / spec.heightRatio;

  const safeWidth =
    Number.isFinite(availableWidth) && availableWidth > 40 ? availableWidth : 320;
  const safeHeight =
    Number.isFinite(availableHeight) && availableHeight > 40 ? availableHeight : 240;

  let baseWidth: number;
  let baseHeight: number;

  if (safeWidth / safeHeight > targetRatio) {
    // Stage is wider than the video frame (e.g. 9:16 inside a landscape studio): constrain by height
    baseHeight = safeHeight;
    baseWidth = baseHeight * targetRatio;
  } else {
    // Stage is taller/narrower than the video frame (e.g. 16:9 inside mobile portrait): constrain by width
    baseWidth = safeWidth;
    baseHeight = baseWidth / targetRatio;
  }

  const scale = isFitMode ? 1 : clampZoom(zoomPercent) / 100;

  return {
    width: Math.max(1, Math.round(baseWidth * scale)),
    height: Math.max(1, Math.round(baseHeight * scale)),
  };
}

export interface SceneDimensions {
  width: number;
  height: number;
  mode: 'fixed' | 'fluid';
  source?: string;
}

export interface AdaptiveViewportLayout {
  sceneWidth: number;
  sceneHeight: number;
  scale: number;
  displayWidth: number;
  displayHeight: number;
  isFixedScene: boolean;
  resolutionLabel: string;
  aspectLabel: string;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function formatSceneAspectLabel(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '16:9';
  }
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.015) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.015) return '9:16';
  if (Math.abs(ratio - 1) < 0.015) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.015) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.015) return '3:4';
  if (Math.abs(ratio - 21 / 9) < 0.02) return '21:9';

  const divisor = gcd(width, height);
  const wPart = Math.round(width / divisor);
  const hPart = Math.round(height / divisor);
  if (wPart <= 32 && hPart <= 32) {
    return `${wPart}:${hPart}`;
  }

  return `${Number(ratio.toFixed(2))}:1`;
}

export const COMPOSITION_RESOLUTION_SPECS: Record<AspectRatio, FrameDimensions> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
};

function parseCssAspectRatio(raw: string): number | null {
  const cleaned = raw.trim();
  const slashMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (slashMatch) {
    const w = parseFloat(slashMatch[1]);
    const h = parseFloat(slashMatch[2]);
    return w > 0 && h > 0 ? w / h : null;
  }
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parsePxValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) && val >= 16 ? Math.round(val) : null;
}

function extractDimensionsFromCssDeclBlock(block: string): FrameDimensions | null {
  const wMatch = block.match(/(?:^|;|\s)(?:width|min-width)\s*:\s*([^;!}]+)/i);
  const hMatch = block.match(/(?:^|;|\s)(?:height|min-height)\s*:\s*([^;!}]+)/i);
  const arMatch = block.match(/(?:^|;|\s)aspect-ratio\s*:\s*([^;!}]+)/i);

  const wPx = parsePxValue(wMatch?.[1]);
  const hPx = parsePxValue(hMatch?.[1]);

  if (wPx && hPx) {
    return { width: wPx, height: hPx };
  }
  if (wPx && arMatch) {
    const ratio = parseCssAspectRatio(arMatch[1]);
    if (ratio) {
      return { width: wPx, height: Math.max(16, Math.round(wPx / ratio)) };
    }
  }
  if (hPx && arMatch) {
    const ratio = parseCssAspectRatio(arMatch[1]);
    if (ratio) {
      return { width: Math.max(16, Math.round(hPx * ratio)), height: hPx };
    }
  }
  return null;
}

/**
 * Statically infers fixed scene surface dimensions from compiled HTML/CSS before iframe boot
 * so scripts reading window.innerWidth/innerHeight on frame 0 receive true scene dimensions.
 */
export function inferInitialSceneDimensions(html: string): SceneDimensions | null {
  if (!html || typeof html !== 'string') return null;

  // Strip scripts and TRENVEDs internal base style so JS strings or base defaults never interfere
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*data-trenveds-base=["']1["'][^>]*>[\s\S]*?<\/style>/gi, '');

  // 1. Standalone SVG document
  const bodyContentMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyContentMatch ? bodyContentMatch[1].trim() : '';
  if (/^<svg\b/i.test(bodyInner) && !/<(?!\/?svg\b|\/?path\b|\/?rect\b|\/?circle\b|\/?g\b|\/?defs\b|\/?linearGradient\b|\/?radialGradient\b|\/?stop\b|\/?text\b|\/?tspan\b|\/?line\b|\/?polygon\b|\/?polyline\b|\/?ellipse\b|\/?use\b|\/?clipPath\b|\/?mask\b|\/?filter\b|\/?fe[A-Za-z]+\b|\/?title\b|\/?desc\b|\/?style\b)[a-z]/i.test(bodyInner)) {
    const svgTag = bodyInner.match(/<svg\b([^>]*)>/i)?.[1] ?? '';
    const svgW = parsePxValue(svgTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/^(\d+(?:\.\d+)?)$/, '$1px'));
    const svgH = parsePxValue(svgTag.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/^(\d+(?:\.\d+)?)$/, '$1px'));
    if (svgW && svgH) {
      return { width: svgW, height: svgH, mode: 'fixed', source: 'preboot-svg' };
    }
    const vbMatch = svgTag.match(/\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i);
    if (vbMatch) {
      const vw = Math.round(parseFloat(vbMatch[1]));
      const vh = Math.round(parseFloat(vbMatch[2]));
      if (vw >= 16 && vh >= 16) {
        return { width: vw, height: vh, mode: 'fixed', source: 'preboot-svg' };
      }
    }
  }

  // 2. Inline style on <html> or <body>
  const htmlStyle = cleaned.match(/<html\b[^>]*\bstyle\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
  const htmlInlineDim = extractDimensionsFromCssDeclBlock(htmlStyle);
  if (htmlInlineDim) {
    return { ...htmlInlineDim, mode: 'fixed', source: 'preboot-html' };
  }

  const bodyStyle = cleaned.match(/<body\b[^>]*\bstyle\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
  const bodyInlineDim = extractDimensionsFromCssDeclBlock(bodyStyle);
  if (bodyInlineDim) {
    return { ...bodyInlineDim, mode: 'fixed', source: 'preboot-body' };
  }

  // 3. CSS rules in <style> blocks targeting html, body, or dedicated stage/root containers
  const styleBlocks = Array.from(cleaned.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)).map(
    (m) => m[1]
  );
  const allCss = styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

  const hasResponsiveViewportSizing = (decl: string): boolean =>
    /(?:^|;|\s)(?:width|min-width)\s*:\s*[^;]*(?:100%|100vw|100dvw)/i.test(decl) &&
    /(?:^|;|\s)(?:height|min-height)\s*:\s*[^;]*(?:100%|100vh|100dvh)/i.test(decl);

  let userResponsiveBody = hasResponsiveViewportSizing(htmlStyle) || hasResponsiveViewportSizing(bodyStyle);
  for (const m of allCss.matchAll(/(?:^|[},])\s*(?:html|:root|body)\s*\{([^}]*)\}/gi)) {
    if (hasResponsiveViewportSizing(m[1])) {
      userResponsiveBody = true;
    }
  }

  const selectorGroups: Array<{ pattern: RegExp; source: string; isInnerContainer?: boolean }> = [
    { pattern: /(?:^|[},])\s*(?:html|:root)\s*\{([^}]*)\}/gi, source: 'preboot-html' },
    { pattern: /(?:^|[},])\s*body\s*\{([^}]*)\}/gi, source: 'preboot-body' },
    {
      pattern: /(?:^|[},])\s*(?:#scene|#stage|#viewport|\.scene|\.stage|#root|#app|main)\s*\{([^}]*)\}/gi,
      source: 'preboot-root-container',
      isInnerContainer: true,
    },
  ];

  for (const group of selectorGroups) {
    const matches = Array.from(allCss.matchAll(group.pattern));
    for (let i = matches.length - 1; i >= 0; i--) {
      const dim = extractDimensionsFromCssDeclBlock(matches[i][1]);
      if (dim) {
        if (group.isInnerContainer && userResponsiveBody && dim.width <= 1920 && dim.height <= 1080) {
          continue;
        }
        return { ...dim, mode: 'fixed', source: group.source };
      }
    }
  }

  // 4. Static <canvas width="..." height="..."> when no explicit responsive body sizing overrides it
  const canvasTags = Array.from(cleaned.matchAll(/<canvas\b([^>]*)>/gi));
  if (canvasTags.length === 1) {
    const attrs = canvasTags[0][1];
    const cw = parseFloat(attrs.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)["']/i)?.[1] ?? '');
    const ch = parseFloat(attrs.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)["']/i)?.[1] ?? '');
    if (Number.isFinite(cw) && Number.isFinite(ch) && cw >= 16 && ch >= 16 && (cw !== 300 || ch !== 150)) {
      return { width: Math.round(cw), height: Math.round(ch), mode: 'fixed', source: 'preboot-canvas' };
    }
  }

  return null;
}

/**
 * Calculates Independent Render Surface dimensions + center-anchored uniform projection scale.
 * Both fixed-dimension scenes and fluid/responsive scenes execute inside their own independent
 * composition surface (exact fixed scene dimensions or Studio target resolution like 1920x1080),
 * never cramped inside the small Studio preview panel, and project cleanly into the stage bounds.
 */
export function calculateAdaptiveViewportLayout(
  availableWidth: number,
  availableHeight: number,
  aspectRatio: AspectRatio,
  zoomPercent: number,
  isFitMode: boolean,
  detectedScene: SceneDimensions | null = null
): AdaptiveViewportLayout {
  const safeAvailW =
    Number.isFinite(availableWidth) && availableWidth > 40 ? availableWidth : 320;
  const safeAvailH =
    Number.isFinite(availableHeight) && availableHeight > 40 ? availableHeight : 240;

  const hasValidFixedScene = Boolean(
    detectedScene &&
      detectedScene.mode === 'fixed' &&
      Number.isFinite(detectedScene.width) &&
      Number.isFinite(detectedScene.height) &&
      detectedScene.width >= 16 &&
      detectedScene.height >= 16
  );

  if (hasValidFixedScene && detectedScene) {
    const sceneWidth = Math.min(32768, Math.max(16, Math.round(detectedScene.width)));
    const sceneHeight = Math.min(32768, Math.max(16, Math.round(detectedScene.height)));

    const fitScale = Math.min(safeAvailW / sceneWidth, safeAvailH / sceneHeight);
    const scale = isFitMode ? fitScale : fitScale * (clampZoom(zoomPercent) / 100);

    const rawDisplayW = Math.max(1, Math.round(sceneWidth * scale));
    const rawDisplayH = Math.max(1, Math.round(sceneHeight * scale));

    const displayWidth = isFitMode ? Math.min(Math.floor(safeAvailW), rawDisplayW) : rawDisplayW;
    const displayHeight = isFitMode ? Math.min(Math.floor(safeAvailH), rawDisplayH) : rawDisplayH;

    return {
      sceneWidth,
      sceneHeight,
      scale,
      displayWidth: Math.max(1, displayWidth),
      displayHeight: Math.max(1, displayHeight),
      isFixedScene: true,
      resolutionLabel: `${sceneWidth} × ${sceneHeight}`,
      aspectLabel: formatSceneAspectLabel(sceneWidth, sceneHeight),
    };
  }

  const spec = getAspectRatioSpec(aspectRatio);
  const composition = COMPOSITION_RESOLUTION_SPECS[aspectRatio];
  const sceneWidth = composition.width;
  const sceneHeight = composition.height;

  const fitScale = Math.min(safeAvailW / sceneWidth, safeAvailH / sceneHeight);
  const scale = isFitMode ? fitScale : fitScale * (clampZoom(zoomPercent) / 100);

  const rawDisplayW = Math.max(1, Math.round(sceneWidth * scale));
  const rawDisplayH = Math.max(1, Math.round(sceneHeight * scale));

  const displayWidth = isFitMode ? Math.min(Math.floor(safeAvailW), rawDisplayW) : rawDisplayW;
  const displayHeight = isFitMode ? Math.min(Math.floor(safeAvailH), rawDisplayH) : rawDisplayH;

  return {
    sceneWidth,
    sceneHeight,
    scale,
    displayWidth: Math.max(1, displayWidth),
    displayHeight: Math.max(1, displayHeight),
    isFixedScene: false,
    resolutionLabel: spec.resolution,
    aspectLabel: aspectRatio,
  };
}

const EXTENSION_LANGUAGE_MAP: Record<string, DetectedLanguage> = {
  html: { id: 'html', label: 'HTML' },
  htm: { id: 'html', label: 'HTML' },
  css: { id: 'css', label: 'CSS' },
  js: { id: 'javascript', label: 'JavaScript' },
  mjs: { id: 'javascript', label: 'JavaScript' },
  cjs: { id: 'javascript', label: 'JavaScript' },
  ts: { id: 'typescript', label: 'TypeScript' },
  mts: { id: 'typescript', label: 'TypeScript' },
  cts: { id: 'typescript', label: 'TypeScript' },
  jsx: { id: 'jsx', label: 'JSX' },
  tsx: { id: 'tsx', label: 'TSX' },
  json: { id: 'json', label: 'JSON' },
  svg: { id: 'svg', label: 'SVG / XML' },
  xml: { id: 'xml', label: 'XML' },
  md: { id: 'markdown', label: 'Markdown' },
  markdown: { id: 'markdown', label: 'Markdown' },
  py: { id: 'python', label: 'Python' },
  txt: { id: 'plaintext', label: 'Plain Text' },
  glsl: { id: 'plaintext', label: 'GLSL Shader' },
  vert: { id: 'plaintext', label: 'Vertex Shader' },
  frag: { id: 'plaintext', label: 'Fragment Shader' },
  wgsl: { id: 'plaintext', label: 'WGSL Shader' },
  csv: { id: 'plaintext', label: 'CSV' },
  yaml: { id: 'plaintext', label: 'YAML' },
  yml: { id: 'plaintext', label: 'YAML' },
  toml: { id: 'plaintext', label: 'TOML' },
  png: { id: 'plaintext', label: 'Image Asset' },
  jpg: { id: 'plaintext', label: 'Image Asset' },
  jpeg: { id: 'plaintext', label: 'Image Asset' },
  webp: { id: 'plaintext', label: 'Image Asset' },
  gif: { id: 'plaintext', label: 'Image Asset' },
  ico: { id: 'plaintext', label: 'Image Asset' },
};

export function detectLanguageFromFilename(filename: string): DetectedLanguage {
  const clean = filename.trim().toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1 || lastDot === clean.length - 1) {
    return { id: 'plaintext', label: 'Plain Text' };
  }
  const ext = clean.slice(lastDot + 1);
  return EXTENSION_LANGUAGE_MAP[ext] ?? { id: 'plaintext', label: 'Plain Text' };
}

export function sanitizeProjectName(rawName: string, fallback = 'Untitled Sequence'): string {
  const trimmed = rawName.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, 64);
}

export function createLocalProject(
  settings: StudioSettings,
  existingCount: number,
  nowIso: string = new Date().toISOString()
): Project {
  const sequenceNumber = existingCount + 1;
  return {
    id: `proj_${Date.now().toString(36)}_${sequenceNumber}`,
    name: `Untitled Sequence ${String(sequenceNumber).padStart(2, '0')}`,
    aspectRatio: settings.defaultAspectRatio,
    frameRate: settings.defaultFrameRate,
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
    files: [],
    activeFilePath: null,
    activityRuns: [],
  };
}

export function clampZoom(zoomPercent: number): number {
  if (!Number.isFinite(zoomPercent)) {
    return 100;
  }
  return Math.min(200, Math.max(25, Math.round(zoomPercent)));
}

export function clampPanelWidth(widthPx: number, minPx: number, maxPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return minPx;
  }
  return Math.min(maxPx, Math.max(minPx, Math.round(widthPx)));
}

export function formatShortTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Just now';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
