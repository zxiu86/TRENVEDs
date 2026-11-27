import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clapperboard,
  Expand,
  Grid,
  Maximize2,
  Minimize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CompiledSceneBundle } from '../runtime/sceneBundler';
import type {
  AspectRatio,
  FrameRate,
  RuntimeDiagnostic,
  RuntimeStatus,
} from '../types/studio';
import {
  calculateAdaptiveViewportLayout,
  getAspectRatioSpec,
  type SceneDimensions,
} from '../utils/studioLogic';

interface SceneViewportProps {
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  zoomPercent: number;
  isFitMode: boolean;
  showGuides: boolean;
  compiledBundle: CompiledSceneBundle | null;
  runtimeStatus: RuntimeStatus;
  runtimeDiagnostics: RuntimeDiagnostic[];
  reloadNonce: number;
  onRuntimeReady: (runId: string) => void;
  onRuntimeDiagnostic: (runId: string, diagnostic: RuntimeDiagnostic) => void;
  onReloadScene: () => void;
  onChangeAspectRatio: (ratio: AspectRatio) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFit: () => void;
  onToggleGuides: () => void;
}

const ASPECT_OPTIONS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3'];

export const SceneViewport: React.FC<SceneViewportProps> = ({
  aspectRatio,
  frameRate,
  zoomPercent,
  isFitMode,
  showGuides,
  compiledBundle,
  runtimeStatus,
  runtimeDiagnostics,
  reloadNonce,
  onRuntimeReady,
  onRuntimeDiagnostic,
  onReloadScene,
  onChangeAspectRatio,
  onZoomIn,
  onZoomOut,
  onToggleFit,
  onToggleGuides,
}) => {
  const spec = getAspectRatioSpec(aspectRatio);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [stageBounds, setStageBounds] = useState<{ width: number; height: number }>({
    width: 640,
    height: 440,
  });
  const [detectedScene, setDetectedScene] = useState<SceneDimensions | null>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);

  const isFullscreen = isNativeFullscreen || isFallbackFullscreen;

  const getFullscreenElement = (): Element | null => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  };

  useEffect(() => {
    setDetectedScene(null);
  }, [compiledBundle?.runId, reloadNonce]);

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const updateBounds = () => {
      const style = window.getComputedStyle(stageEl);
      const padX =
        parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
      const padY =
        parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
      const innerWidth = Math.max(0, stageEl.clientWidth - padX);
      const innerHeight = Math.max(0, stageEl.clientHeight - padY);
      setStageBounds((prev) =>
        prev.width === innerWidth && prev.height === innerHeight
          ? prev
          : { width: innerWidth, height: innerHeight }
      );
    };

    updateBounds();
    let raf2Id = 0;
    const rafId = window.requestAnimationFrame(() => {
      updateBounds();
      raf2Id = window.requestAnimationFrame(() => {
        updateBounds();
      });
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateBounds();
      });
      observer.observe(stageEl);
      window.addEventListener('resize', updateBounds);
      return () => {
        window.cancelAnimationFrame(rafId);
        if (raf2Id) window.cancelAnimationFrame(raf2Id);
        observer.disconnect();
        window.removeEventListener('resize', updateBounds);
      };
    }

    window.addEventListener('resize', updateBounds);
    return () => {
      window.cancelAnimationFrame(rafId);
      if (raf2Id) window.cancelAnimationFrame(raf2Id);
      window.removeEventListener('resize', updateBounds);
    };
  }, [isFullscreen]);

  // Listen strictly to messages originating from our sandboxed scene iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data as {
        channel?: string;
        runId?: string;
        type?: string;
        mode?: 'fixed' | 'fluid';
        width?: number;
        height?: number;
        message?: string;
        source?: string;
        line?: number;
        column?: number;
      } | null;

      if (!data || data.channel !== 'trenveds-runtime') return;
      if (!compiledBundle || data.runId !== compiledBundle.runId) return;

      if (data.type === 'scene-dimensions') {
        if (
          data.mode === 'fixed' &&
          typeof data.width === 'number' &&
          typeof data.height === 'number' &&
          Number.isFinite(data.width) &&
          Number.isFinite(data.height) &&
          data.width >= 16 &&
          data.height >= 16
        ) {
          const nextW = Math.round(data.width);
          const nextH = Math.round(data.height);
          setDetectedScene((prev) => {
            if (
              prev &&
              prev.mode === 'fixed' &&
              Math.abs(prev.width - nextW) <= 1 &&
              Math.abs(prev.height - nextH) <= 1
            ) {
              return prev;
            }
            return {
              width: nextW,
              height: nextH,
              mode: 'fixed',
              source: data.source,
            };
          });
        } else if (data.mode === 'fluid') {
          setDetectedScene((prev) => (prev === null || prev.mode === 'fluid' ? prev : null));
        }
        return;
      }

      if (data.type === 'ready') {
        onRuntimeReady(data.runId);
        return;
      }

      if (data.type === 'runtime-error' || data.type === 'console-error') {
        onRuntimeDiagnostic(data.runId, {
          id: `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          type: data.type,
          message: String(data.message || 'Scene runtime error'),
          source: data.source,
          line: data.line,
          column: data.column,
          timestamp: new Date().toISOString(),
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [compiledBundle, onRuntimeReady, onRuntimeDiagnostic]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = getFullscreenElement() === fullscreenContainerRef.current;
      setIsNativeFullscreen(active);
      if (active) {
        setIsFallbackFullscreen(false);
      }
    };

    const handleFullscreenError = () => {
      setIsNativeFullscreen(false);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', handleFullscreenError);
    document.addEventListener('webkitfullscreenerror', handleFullscreenError);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('fullscreenerror', handleFullscreenError);
      document.removeEventListener('webkitfullscreenerror', handleFullscreenError);
    };
  }, []);

  useEffect(() => {
    if (!isFallbackFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFallbackFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFallbackFullscreen]);

  useEffect(() => {
    if (!fullscreenNotice) return;
    const timer = window.setTimeout(() => setFullscreenNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [fullscreenNotice]);

  const handleToggleFullscreen = useCallback(async () => {
    const container = fullscreenContainerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (!container) return;

    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };

    try {
      if (getFullscreenElement() === container) {
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          await doc.webkitExitFullscreen();
        }
        setIsNativeFullscreen(false);
        return;
      }

      if (isFallbackFullscreen) {
        setIsFallbackFullscreen(false);
        return;
      }

      if (typeof container.requestFullscreen === 'function') {
        await container.requestFullscreen();
        return;
      }

      if (typeof container.webkitRequestFullscreen === 'function') {
        await container.webkitRequestFullscreen();
        return;
      }

      // Clean viewport-filling fallback when browser/iframe blocks native Fullscreen API
      setIsFallbackFullscreen(true);
    } catch {
      setIsFallbackFullscreen(true);
    }
  }, [isFallbackFullscreen]);

  const layout = calculateAdaptiveViewportLayout(
    stageBounds.width,
    stageBounds.height,
    aspectRatio,
    zoomPercent,
    isFitMode || isFullscreen,
    detectedScene
  );

  const isCompactFrame = layout.displayWidth < 290 || layout.displayHeight < 230;
  const hasCompiledScene = Boolean(compiledBundle && compiledBundle.html);

  return (
    <section
      aria-label="Scene Viewport"
      className={
        isFallbackFullscreen
          ? 'flex h-full min-h-0 flex-col rounded-xl'
          : 'studio-glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-colors duration-200 ease-out'
      }
    >
      {/* Compact Viewport Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <Clapperboard className="h-3.5 w-3.5 shrink-0 text-red-400" />
          <h2 className="font-display text-xs font-semibold tracking-wide text-zinc-100 truncate">
            Scene Viewport
          </h2>
          {runtimeStatus !== 'empty' && (
            <span
              data-testid="runtime-status-badge"
              data-status={runtimeStatus}
              data-runtime-mode={compiledBundle?.runtimeMode ?? ''}
              title={
                compiledBundle?.entryPath
                  ? `Entry: ${compiledBundle.entryPath} (${compiledBundle.runtimeMode})`
                  : undefined
              }
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                runtimeStatus === 'running'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                  : runtimeStatus === 'error'
                    ? 'border-red-500/45 bg-red-600/15 text-red-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
              }`}
            >
              {runtimeStatus === 'running'
                ? 'Live'
                : runtimeStatus === 'error'
                  ? 'Error'
                  : runtimeStatus === 'compiling'
                    ? 'Compiling'
                    : 'Preparing'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-zinc-400 whitespace-nowrap shrink-0">
          <span className="hidden sm:inline" data-testid="viewport-resolution-label">
            {layout.resolutionLabel}
          </span>
          <span aria-hidden="true" className="hidden sm:inline text-zinc-600">
            ·
          </span>
          <span data-testid="viewport-aspect-label">{layout.aspectLabel}</span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span>{frameRate} fps</span>
        </div>
      </div>

      {/* Dedicated Presentation Surface (targeted by Browser Fullscreen API) */}
      <div
        ref={fullscreenContainerRef}
        data-testid="viewport-presentation-root"
        data-fullscreen={isFullscreen ? 'true' : 'false'}
        onContextMenu={(event) => event.preventDefault()}
        className={`viewport-video-surface flex flex-col overflow-hidden ${
          isFallbackFullscreen
            ? 'fixed inset-0 z-[60] h-dvh w-screen bg-[#040406]'
            : isNativeFullscreen
              ? 'relative h-full w-full bg-[#040406]'
              : 'relative flex-1 min-h-0'
        }`}
      >
        {/* Central Dark Neutral Canvas Stage */}
        <div
          ref={stageRef}
          data-testid="scene-viewport-stage"
          className={`viewport-stage-grid studio-scroll relative flex-1 min-h-0 overflow-auto flex ${
            isFullscreen ? 'p-4 sm:p-8' : 'p-4 sm:p-6'
          }`}
        >
          {/* Contained Video Frame (adaptive dimensions, center-anchored uniform scaling) */}
          <div
            data-testid="viewport-frame"
            data-aspect-ratio={layout.aspectLabel}
            data-scene-width={layout.sceneWidth}
            data-scene-height={layout.sceneHeight}
            data-scene-scale={layout.scale.toFixed(6)}
            data-scene-mode={layout.isFixedScene ? 'fixed' : 'fluid'}
            draggable={false}
            onCopy={(event) => event.preventDefault()}
            onDragStart={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
            style={{
              width: `${layout.displayWidth}px`,
              height: `${layout.displayHeight}px`,
            }}
            className="viewport-video-surface crimson-edge-left crimson-edge-right relative m-auto shrink-0 flex items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-[#08090D] shadow-[0_32px_90px_-24px_rgba(0,0,0,0.96),inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            {hasCompiledScene && compiledBundle ? (
              <iframe
                ref={iframeRef}
                key={`${compiledBundle.runId}-${reloadNonce}`}
                data-testid="scene-runtime-iframe"
                data-render-width={layout.sceneWidth}
                data-render-height={layout.sceneHeight}
                data-scale={layout.scale.toFixed(6)}
                title="TRENVEDs Isolated Scene Runtime"
                sandbox="allow-scripts"
                srcDoc={compiledBundle.html}
                style={
                  layout.isFixedScene
                    ? {
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: `${layout.sceneWidth}px`,
                        height: `${layout.sceneHeight}px`,
                        transform: `translate(-50%, -50%) scale(${layout.scale})`,
                        transformOrigin: 'center center',
                      }
                    : undefined
                }
                className={
                  layout.isFixedScene
                    ? 'border-0 bg-[#060608]'
                    : 'h-full w-full border-0 bg-[#060608]'
                }
              />
            ) : (
              <div
                className={`relative z-10 rounded-xl border border-white/[0.06] bg-[#08090D]/90 text-center backdrop-blur-sm ${
                  isCompactFrame ? 'max-w-[90%] px-3 py-3' : 'max-w-xs sm:max-w-sm px-5 py-4'
                }`}
              >
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300">
                  <Clapperboard className="h-4.5 w-4.5 text-red-400" />
                </div>
                <p className="mt-2.5 font-display text-xs sm:text-sm font-semibold text-zinc-100">
                  Scene monitor ready
                </p>
                {!isCompactFrame && (
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                    Describe a scene in AI Direction to compile and run live animated output inside this {aspectRatio} frame.
                  </p>
                )}
                <p className="mt-2.5 font-mono tabular-nums text-[11px] text-zinc-500">
                  {spec.label} · {spec.resolution} · {frameRate} fps
                </p>
              </div>
            )}

            {/* Optional Safe-Area & Rule-of-Thirds Guides (overlay strictly pointer-events-none) */}
            {showGuides && (
              <div
                data-testid="viewport-guides"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10"
              >
                <div className="absolute inset-[8%] border border-dashed border-white/10" />
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/[0.05]" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/[0.05]" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/[0.05]" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/[0.05]" />
                <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-red-500/40" />
                <div className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-red-500/40" />
              </div>
            )}

            {/* Honest Runtime / Compile Diagnostic Overlay when errors exist */}
            {runtimeDiagnostics.length > 0 && (
              <div
                data-testid="runtime-error-overlay"
                role="alert"
                className="studio-glass-elevated absolute inset-x-3 bottom-3 z-20 max-h-[42%] overflow-y-auto studio-scroll rounded-lg border border-red-500/45 px-3 py-2 text-xs text-red-200"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium text-red-100">
                      Scene Runtime Diagnostic
                      {runtimeDiagnostics.length > 1 ? ` (${runtimeDiagnostics.length})` : ''}
                    </p>
                    {runtimeDiagnostics.slice(0, 3).map((diag) => (
                      <p key={diag.id} className="text-[11px] text-red-200/90 break-words">
                        {diag.source ? <span className="font-mono text-red-300">{diag.source}{diag.line ? `:${diag.line}` : ''}: </span> : null}
                        {diag.message}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dedicated Non-Overlapping Bottom HUD shown ONLY while Fullscreen is active */}
        {isFullscreen && (
          <div className="shrink-0 flex items-center justify-center bg-[#040406] px-3 pb-4 pt-1">
            <div
              data-testid="fullscreen-hud"
              className="studio-glass-elevated studio-dialog-panel flex max-w-full flex-wrap items-center justify-center gap-2 sm:gap-3 rounded-xl px-3 sm:px-4 py-2 text-xs"
            >
              <span className="font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                {layout.aspectLabel} · {layout.resolutionLabel}
              </span>
              <span aria-hidden="true" className="hidden sm:inline h-3.5 w-px bg-white/15" />
              <div className="flex items-center gap-2">
                {hasCompiledScene && (
                  <button
                    type="button"
                    onClick={onReloadScene}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-white whitespace-nowrap"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>Replay</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleGuides}
                  aria-pressed={showGuides}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    showGuides
                      ? 'border-red-500/45 bg-red-600/20 text-white'
                      : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white'
                  }`}
                >
                  <Grid className="h-3.5 w-3.5" />
                  <span>Guides</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500 whitespace-nowrap"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span>Exit Fullscreen</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Graceful Notice if Browser Rejects Fullscreen */}
        {fullscreenNotice && (
          <div
            role="status"
            className="studio-glass-elevated studio-dialog-panel absolute top-4 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-red-500/35 px-3.5 py-2 text-xs text-zinc-200 whitespace-nowrap"
          >
            {fullscreenNotice}
          </div>
        )}
      </div>

      {/* Bottom Viewport Display Controls */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-black/30 px-3 py-2">
        {/* Aspect Ratio Selector */}
        <div
          role="group"
          aria-label="Aspect ratio"
          className="studio-glass-control flex items-center gap-1 rounded-lg p-0.5"
        >
          {ASPECT_OPTIONS.map((ratio) => {
            const active = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => onChangeAspectRatio(ratio)}
                aria-pressed={active}
                className={`h-8 rounded-md px-2.5 font-mono text-[11px] transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
                  active
                    ? 'bg-red-600/25 text-white border border-red-500/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                    : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 border border-transparent'
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>

        {/* Display Options, Reload, Zoom & Fullscreen Controls */}
        <div className="flex items-center gap-1.5">
          {hasCompiledScene && (
            <button
              type="button"
              onClick={onReloadScene}
              aria-label="Reload scene runtime"
              title="Restart scene playback"
              className="studio-glass-control inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-300 transition-all duration-150 hover:border-red-500/40 hover:text-white whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Replay</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleGuides}
            aria-pressed={showGuides}
            className={`studio-glass-control inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
              showGuides
                ? 'border-red-500/45 bg-red-600/20 text-zinc-100'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span>Guides</span>
          </button>

          <div className="studio-glass-control flex items-center gap-0.5 rounded-lg p-0.5">
            <button
              type="button"
              onClick={onZoomOut}
              aria-label="Viewport zoom out"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-[11px] text-zinc-300">
              {isFitMode ? 'Fit' : `${zoomPercent}%`}
            </span>
            <button
              type="button"
              onClick={onZoomIn}
              aria-label="Viewport zoom in"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleFit}
              aria-pressed={isFitMode}
              aria-label="Fit frame to viewport"
              className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors duration-150 ${
                isFitMode
                  ? 'bg-red-600/25 text-red-200'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Maximize2 className="h-3 w-3" />
              <span className="hidden sm:inline">Fit</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="studio-glass-control inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-200 transition-all duration-150 hover:border-red-500/40 hover:bg-red-600/15 hover:text-white whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500"
          >
            <Expand className="h-3.5 w-3.5 text-red-400" />
            <span className="hidden sm:inline">Fullscreen</span>
          </button>
        </div>
      </div>
    </section>
  );
};
