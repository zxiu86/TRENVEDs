import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Code2, MessageSquare } from 'lucide-react';
import {
  compileSceneBundle,
  type CompiledSceneBundle,
} from '../runtime/sceneBundler';
import { executeAiSceneTurn } from '../services/aiBrain';
import type {
  ActivityRun,
  AiProviderConfig,
  AiStatus,
  AspectRatio,
  ChatMessage,
  MobilePanelTab,
  Project,
  RuntimeDiagnostic,
  RuntimeStatus,
  SceneFile,
  StudioSettings,
} from '../types/studio';
import { clampPanelWidth, clampZoom } from '../utils/studioLogic';
import { AiChatPanel } from './AiChatPanel';
import { ExportModal } from './ExportModal';
import { SceneViewport } from './SceneViewport';
import { ScriptCodePanel } from './ScriptCodePanel';
import type { SettingsTab } from './SettingsModal';
import { StudioTopBar } from './StudioTopBar';

interface StudioWorkspaceProps {
  project: Project;
  settings: StudioSettings;
  activeProvider: AiProviderConfig | null;
  onBackToLanding: () => void;
  onUpdateProject: (updated: Project) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
}

interface PendingRuntimeVerification {
  runId: string;
  diagnostics: RuntimeDiagnostic[];
  settled: boolean;
  settleTimer: number | null;
  timeoutTimer: number;
  resolve: (diagnostics: RuntimeDiagnostic[]) => void;
}

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  project,
  settings,
  activeProvider,
  onBackToLanding,
  onUpdateProject,
  onOpenSettings,
}) => {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFitMode, setIsFitMode] = useState(true);
  const [showGuides, setShowGuides] = useState(settings.showGuidesByDefault);
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [activeRun, setActiveRun] = useState<ActivityRun | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Runtime state for the isolated sandboxed Scene Viewport
  const [compiledBundle, setCompiledBundle] = useState<CompiledSceneBundle | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>('empty');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Desktop/Tablet panel open & resizable widths
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isCodeOpen, setIsCodeOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(340);
  const [codeWidth, setCodeWidth] = useState(370);

  // Mobile/compact tab state
  const [mobileTab, setMobileTab] = useState<MobilePanelTab>('viewport');

  const projectRef = useRef(project);
  projectRef.current = project;
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingVerificationRef = useRef<PendingRuntimeVerification | null>(null);

  const clearPendingVerification = useCallback(() => {
    const pending = pendingVerificationRef.current;
    if (!pending) return;
    if (pending.settleTimer) window.clearTimeout(pending.settleTimer);
    window.clearTimeout(pending.timeoutTimer);
    if (!pending.settled) {
      pending.settled = true;
      pending.resolve(pending.diagnostics);
    }
    pendingVerificationRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearPendingVerification();
    };
  }, [project.id, clearPendingVerification]);

  // Compile initial project files if reopening a populated project
  useEffect(() => {
    if (project.files.length === 0) {
      setCompiledBundle(null);
      setRuntimeStatus('empty');
      setRuntimeDiagnostics([]);
      return;
    }

    if (!compiledBundle) {
      const bundle = compileSceneBundle(project.files, {
        aspectRatio: project.aspectRatio,
        frameRate: project.frameRate,
      });
      setCompiledBundle(bundle);
      setRuntimeDiagnostics(bundle.diagnostics);
      setRuntimeStatus(bundle.diagnostics.length > 0 ? 'error' : 'compiling');
    }
    // Only re-evaluate when project.id changes or files become empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.files.length]);

  const handleRenameProject = (nextName: string) => {
    onUpdateProject({
      ...projectRef.current,
      name: nextName,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleChangeAspectRatio = (ratio: AspectRatio) => {
    onUpdateProject({
      ...projectRef.current,
      aspectRatio: ratio,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSelectFile = (path: string) => {
    onUpdateProject({
      ...projectRef.current,
      activeFilePath: path,
    });
    if (window.innerWidth < 768) {
      setMobileTab('code');
    } else if (!isCodeOpen) {
      setIsCodeOpen(true);
    }
  };

  const handleZoomIn = () => {
    setIsFitMode(false);
    setZoomPercent((prev) => clampZoom(prev + 15));
  };

  const handleZoomOut = () => {
    setIsFitMode(false);
    setZoomPercent((prev) => clampZoom(prev - 15));
  };

  const handleToggleFit = () => {
    setIsFitMode((prev) => !prev);
    setZoomPercent(100);
  };

  const handleRuntimeReady = useCallback((runId: string) => {
    setRuntimeStatus((prev) => (prev === 'error' ? 'error' : 'running'));

    const pending = pendingVerificationRef.current;
    if (pending && pending.runId === runId && !pending.settled) {
      if (pending.settleTimer) window.clearTimeout(pending.settleTimer);
      pending.settleTimer = window.setTimeout(() => {
        if (pending.settled) return;
        pending.settled = true;
        window.clearTimeout(pending.timeoutTimer);
        pendingVerificationRef.current = null;
        pending.resolve(pending.diagnostics);
      }, 200);
    }
  }, []);

  const handleRuntimeDiagnostic = useCallback(
    (runId: string, diagnostic: RuntimeDiagnostic) => {
      setRuntimeDiagnostics((prev) => [...prev.slice(-4), diagnostic]);
      setRuntimeStatus('error');

      const pending = pendingVerificationRef.current;
      if (pending && pending.runId === runId && !pending.settled) {
        pending.diagnostics.push(diagnostic);
        if (pending.settleTimer) window.clearTimeout(pending.settleTimer);
        pending.settleTimer = window.setTimeout(() => {
          if (pending.settled) return;
          pending.settled = true;
          window.clearTimeout(pending.timeoutTimer);
          pendingVerificationRef.current = null;
          pending.resolve(pending.diagnostics);
        }, 160);
      }
    },
    []
  );

  const mountAndVerifyRuntime = useCallback(
    (bundle: CompiledSceneBundle): Promise<RuntimeDiagnostic[]> => {
      clearPendingVerification();

      return new Promise<RuntimeDiagnostic[]>((resolve) => {
        const timeoutTimer = window.setTimeout(() => {
          const pending = pendingVerificationRef.current;
          if (!pending || pending.runId !== bundle.runId || pending.settled) return;
          pending.settled = true;
          if (pending.settleTimer) window.clearTimeout(pending.settleTimer);
          pendingVerificationRef.current = null;
          setRuntimeStatus(pending.diagnostics.length > 0 ? 'error' : 'running');
          resolve(pending.diagnostics);
        }, 3200);

        pendingVerificationRef.current = {
          runId: bundle.runId,
          diagnostics: [],
          settled: false,
          settleTimer: null,
          timeoutTimer,
          resolve,
        };

        setRuntimeDiagnostics([]);
        setRuntimeStatus('compiling');
        setCompiledBundle(bundle);
        setReloadNonce((n) => n + 1);
      });
    },
    [clearPendingVerification]
  );

  const handleReloadScene = () => {
    if (projectRef.current.files.length === 0) return;
    const bundle = compileSceneBundle(projectRef.current.files, {
      aspectRatio: projectRef.current.aspectRatio,
      frameRate: projectRef.current.frameRate,
    });
    setRuntimeDiagnostics(bundle.diagnostics);
    setRuntimeStatus(bundle.diagnostics.length > 0 ? 'error' : 'compiling');
    setCompiledBundle(bundle);
    setReloadNonce((n) => n + 1);
  };

  const handleSendMessage = async (rawContent: string) => {
    if (!activeProvider || !activeProvider.apiKey.trim()) {
      onOpenSettings('providers');
      return;
    }

    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `msg_u_${Date.now().toString(36)}`,
      role: 'user',
      content: rawContent,
      timestamp: now,
    };

    const withUser: Project = {
      ...projectRef.current,
      updatedAt: now,
      messages: [...projectRef.current.messages, userMessage],
    };
    onUpdateProject(withUser);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const result = await executeAiSceneTurn({
      provider: activeProvider,
      userPrompt: rawContent,
      projectName: withUser.name,
      aspectRatio: withUser.aspectRatio,
      frameRate: withUser.frameRate,
      initialFiles: withUser.files,
      chatHistory: projectRef.current.messages,
      signal: controller.signal,
      onStatusChange: setAiStatus,
      onActivityUpdate: (snapshot) => {
        setActiveRun(snapshot);
      },
      onFilesUpdated: (nextFiles: SceneFile[], primaryTouchedPath: string | null) => {
        const latest = projectRef.current;
        onUpdateProject({
          ...latest,
          files: nextFiles,
          activeFilePath:
            primaryTouchedPath ??
            (latest.activeFilePath && nextFiles.some((f) => f.path === latest.activeFilePath)
              ? latest.activeFilePath
              : nextFiles[0]?.path ?? null),
          updatedAt: new Date().toISOString(),
        });
      },
      mountAndVerifyRuntime,
    });

    if (controller.signal.aborted) return;

    setActiveRun(null);

    if (result.compiledBundle) {
      setCompiledBundle(result.compiledBundle);
      if (result.isError) {
        setRuntimeStatus('error');
      }
    }

    const replyTime = new Date().toISOString();
    const assistantMessage: ChatMessage = {
      id: `msg_a_${Date.now().toString(36)}`,
      role: 'assistant',
      content: result.assistantMessage,
      timestamp: replyTime,
      activityRunId: result.activityRun.id,
      isError: result.isError,
    };

    const completedRun: ActivityRun = {
      ...result.activityRun,
      messageId: assistantMessage.id,
    };

    const latest = projectRef.current;
    onUpdateProject({
      ...latest,
      files: result.finalFiles,
      activeFilePath:
        result.primaryTouchedPath ??
        (latest.activeFilePath && result.finalFiles.some((f) => f.path === latest.activeFilePath)
          ? latest.activeFilePath
          : result.finalFiles[0]?.path ?? null),
      messages: [...latest.messages, assistantMessage],
      activityRuns: [...latest.activityRuns, completedRun],
      updatedAt: replyTime,
    });
  };

  const handleClearMessages = () => {
    abortControllerRef.current?.abort();
    clearPendingVerification();
    setActiveRun(null);
    setAiStatus('idle');
    onUpdateProject({
      ...projectRef.current,
      updatedAt: new Date().toISOString(),
      messages: [],
      activityRuns: [],
    });
  };

  const startResizeLeft = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = chatWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setChatWidth(clampPanelWidth(initialWidth + delta, 260, 440));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResizeRight = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = codeWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setCodeWidth(clampPanelWidth(initialWidth + delta, 280, 500));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="studio-ambient-stage flex h-dvh w-full flex-col overflow-hidden text-zinc-100">
      <StudioTopBar
        projectName={project.name}
        aspectRatio={project.aspectRatio}
        zoomPercent={zoomPercent}
        isFitMode={isFitMode}
        isChatOpen={isChatOpen}
        isCodeOpen={isCodeOpen}
        onBackToLanding={onBackToLanding}
        onRenameProject={handleRenameProject}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onToggleFit={handleToggleFit}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        onToggleCode={() => setIsCodeOpen((prev) => !prev)}
        onOpenSettings={() => onOpenSettings('preferences')}
        onOpenExport={() => setIsExportOpen(true)}
      />

      {/* Mobile Panel Switcher (< md) */}
      <div className="studio-glass-header flex md:hidden shrink-0 items-center gap-1 px-3 py-1.5">
        <div role="tablist" aria-label="Studio workspace panels" className="grid w-full grid-cols-3 gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'viewport'}
            onClick={() => setMobileTab('viewport')}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
              mobileTab === 'viewport'
                ? 'bg-red-600/20 text-white border border-red-500/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                : 'text-zinc-400 border border-transparent hover:text-zinc-200'
            }`}
          >
            <Clapperboard className="h-3.5 w-3.5" />
            <span>Viewport</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'chat'}
            onClick={() => setMobileTab('chat')}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
              mobileTab === 'chat'
                ? 'bg-red-600/20 text-white border border-red-500/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                : 'text-zinc-400 border border-transparent hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chat</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'code'}
            onClick={() => setMobileTab('code')}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
              mobileTab === 'code'
                ? 'bg-red-600/20 text-white border border-red-500/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                : 'text-zinc-400 border border-transparent hover:text-zinc-200'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Script</span>
          </button>
        </div>
      </div>

      {/* Unified Responsive Studio Workspace */}
      <main className="flex flex-1 min-h-0 gap-2 p-2 md:p-2.5 overflow-hidden">
        <aside
          style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
          className={`h-full min-h-0 shrink-0 ${
            mobileTab === 'chat' ? 'w-full flex-1 md:flex-none' : 'hidden'
          } ${
            isChatOpen
              ? 'md:block md:w-[var(--chat-w)] md:max-w-[220px] lg:max-w-[300px] xl:max-w-[440px]'
              : 'md:hidden'
          }`}
        >
          <AiChatPanel
            messages={project.messages}
            activityRuns={project.activityRuns}
            activeRun={activeRun}
            activeProvider={activeProvider}
            aiStatus={aiStatus}
            onSendMessage={handleSendMessage}
            onClearMessages={handleClearMessages}
            onOpenAiSettings={() => onOpenSettings('providers')}
            onSelectFile={handleSelectFile}
            onCollapse={() => setIsChatOpen(false)}
          />
        </aside>

        {isChatOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize AI Chat panel"
            onPointerDown={startResizeLeft}
            className="hidden xl:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-red-500/35"
          >
            <div className="h-10 w-0.5 rounded-full bg-white/15" />
          </div>
        )}

        <div
          className={`min-w-0 min-h-0 h-full flex-1 ${
            mobileTab === 'viewport' ? 'block' : 'hidden md:block'
          }`}
        >
          <SceneViewport
            aspectRatio={project.aspectRatio}
            frameRate={project.frameRate}
            zoomPercent={zoomPercent}
            isFitMode={isFitMode}
            showGuides={showGuides}
            compiledBundle={compiledBundle}
            runtimeStatus={runtimeStatus}
            runtimeDiagnostics={runtimeDiagnostics}
            reloadNonce={reloadNonce}
            onRuntimeReady={handleRuntimeReady}
            onRuntimeDiagnostic={handleRuntimeDiagnostic}
            onReloadScene={handleReloadScene}
            onChangeAspectRatio={handleChangeAspectRatio}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onToggleFit={handleToggleFit}
            onToggleGuides={() => setShowGuides((prev) => !prev)}
          />
        </div>

        {isCodeOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize AI Script panel"
            onPointerDown={startResizeRight}
            className="hidden xl:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-red-500/35"
          >
            <div className="h-10 w-0.5 rounded-full bg-white/15" />
          </div>
        )}

        <aside
          style={{ '--code-w': `${codeWidth}px` } as React.CSSProperties}
          className={`h-full min-h-0 shrink-0 ${
            mobileTab === 'code' ? 'w-full flex-1 md:flex-none' : 'hidden'
          } ${
            isCodeOpen
              ? 'md:block md:w-[var(--code-w)] md:max-w-[230px] lg:max-w-[320px] xl:max-w-[500px]'
              : 'md:hidden'
          }`}
        >
          <ScriptCodePanel
            files={project.files}
            activeFilePath={project.activeFilePath}
            onSelectFile={handleSelectFile}
            showLineNumbers={settings.showLineNumbers}
            onCollapse={() => setIsCodeOpen(false)}
          />
        </aside>
      </main>

      <ExportModal
        isOpen={isExportOpen}
        project={project}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
};
