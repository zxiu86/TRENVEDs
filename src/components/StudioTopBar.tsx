import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Code2,
  Download,
  Maximize2,
  MessageSquare,
  Pencil,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AspectRatio } from '../types/studio';
import { sanitizeProjectName } from '../utils/studioLogic';
import { BrandMark } from './BrandMark';

interface StudioTopBarProps {
  projectName: string;
  aspectRatio: AspectRatio;
  zoomPercent: number;
  isFitMode: boolean;
  isChatOpen: boolean;
  isCodeOpen: boolean;
  onBackToLanding: () => void;
  onRenameProject: (nextName: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFit: () => void;
  onToggleChat: () => void;
  onToggleCode: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
}

export const StudioTopBar: React.FC<StudioTopBarProps> = ({
  projectName,
  aspectRatio,
  zoomPercent,
  isFitMode,
  isChatOpen,
  isCodeOpen,
  onBackToLanding,
  onRenameProject,
  onZoomIn,
  onZoomOut,
  onToggleFit,
  onToggleChat,
  onToggleCode,
  onOpenSettings,
  onOpenExport,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftName(projectName);
  }, [projectName]);

  useEffect(() => {
    if (isEditingName) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingName]);

  const commitRename = () => {
    const clean = sanitizeProjectName(draftName, projectName);
    setDraftName(clean);
    onRenameProject(clean);
    setIsEditingName(false);
  };

  const cancelRename = () => {
    setDraftName(projectName);
    setIsEditingName(false);
  };

  return (
    <header className="studio-glass-header relative z-20 flex h-13 shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
      {/* Left Zone: Back, Brand, Editable Project Title */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onBackToLanding}
          aria-label="Back to projects"
          className="studio-glass-control inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-300 transition-all duration-150 hover:bg-white/[0.1] hover:text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-500"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Projects</span>
        </button>

        <div className="hidden lg:flex items-center">
          <BrandMark compact />
        </div>

        <span aria-hidden="true" className="hidden lg:inline text-zinc-700">
          /
        </span>

        {isEditingName ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
            className="flex items-center gap-1.5 min-w-0"
          >
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
              aria-label="Project name"
              maxLength={64}
              className="h-8 w-36 sm:w-52 rounded-md border border-red-500/60 bg-black/50 px-2.5 text-xs sm:text-sm font-medium text-white outline-none"
            />
            <button
              type="submit"
              aria-label="Save project name"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-500 shrink-0"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            title="Rename project"
            aria-label={`Rename project ${projectName}`}
            className="group inline-flex h-9 min-w-0 max-w-[170px] sm:max-w-[240px] items-center gap-1.5 rounded-lg px-2 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-red-500"
          >
            <span className="truncate text-xs sm:text-sm font-medium text-zinc-100">
              {projectName}
            </span>
            <Pencil className="h-3 w-3 shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-300" />
          </button>
        )}
      </div>

      {/* Center Zone: Viewport Zoom & Fit Summary (Desktop/Tablet) */}
      <div className="studio-glass-control hidden md:flex items-center gap-1 rounded-lg p-0.5 shrink-0">
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out viewport"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="px-2 font-mono tabular-nums text-xs text-zinc-300 whitespace-nowrap">
          {isFitMode ? 'Fit' : `${zoomPercent}%`}
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in viewport"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <div className="mx-0.5 h-4 w-px bg-white/10" aria-hidden="true" />
        <button
          type="button"
          onClick={onToggleFit}
          aria-pressed={isFitMode}
          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
            isFitMode
              ? 'bg-red-600/20 text-red-300'
              : 'text-zinc-400 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Maximize2 className="h-3 w-3" />
          <span>Fit</span>
        </button>
        <span className="px-2 font-mono tabular-nums text-xs text-zinc-500 border-l border-white/10">
          {aspectRatio}
        </span>
      </div>

      {/* Right Zone: Panel Toggles, Settings, Export */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div className="hidden md:flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleChat}
            aria-pressed={isChatOpen}
            aria-label={isChatOpen ? 'Collapse AI Chat panel' : 'Expand AI Chat panel'}
            className={`studio-glass-control inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
              isChatOpen
                ? 'border-red-500/45 bg-red-600/15 text-zinc-100'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Chat</span>
          </button>

          <button
            type="button"
            onClick={onToggleCode}
            aria-pressed={isCodeOpen}
            aria-label={isCodeOpen ? 'Collapse AI Script panel' : 'Expand AI Script panel'}
            className={`studio-glass-control inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
              isCodeOpen
                ? 'border-red-500/45 bg-red-600/15 text-zinc-100'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Script</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open Studio Settings"
          className="studio-glass-control inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-all duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
        >
          <Settings className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 sm:px-3.5 text-xs font-medium text-white transition-colors hover:bg-red-500 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-400"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
