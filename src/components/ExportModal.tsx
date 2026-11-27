import React, { useEffect } from 'react';
import { Film, X } from 'lucide-react';
import type { Project } from '../types/studio';
import { getAspectRatioSpec } from '../utils/studioLogic';

interface ExportModalProps {
  isOpen: boolean;
  project: Project;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  project,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const spec = getAspectRatioSpec(project.aspectRatio);

  return (
    <div
      className="studio-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        className="studio-glass-elevated studio-dialog-panel crimson-edge-left w-full max-w-md rounded-xl p-6 text-zinc-100"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/30 bg-red-600/10 text-red-400">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <h2 id="export-dialog-title" className="text-base font-semibold text-white">
                Export & Render
              </h2>
              <p className="text-xs text-zinc-400">Planned for future release</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <p className="text-sm leading-relaxed text-zinc-300">
            Video encoding, frame capture, and rendered export remain planned for a future release. Your live scene in TRENVEDs V1.3 runs interactively in the Scene Viewport and can be edited directly via AI Script.
          </p>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Project</span>
              <span className="font-medium text-zinc-100 truncate max-w-[220px]">{project.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Target Canvas</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {spec.resolution} ({project.aspectRatio})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Frame Rate</span>
              <span className="font-mono tabular-nums text-zinc-200">{project.frameRate} fps</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Scene Files</span>
              <span className="font-mono tabular-nums text-zinc-200">{project.files.length}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-white/15 bg-white/10 px-5 text-sm font-medium text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-red-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
