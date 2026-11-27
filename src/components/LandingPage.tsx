import React, { useState } from 'react';
import {
  ArrowRight,
  Clapperboard,
  Code2,
  FolderOpen,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import type { Project } from '../types/studio';
import { formatShortTimestamp, getAspectRatioSpec } from '../utils/studioLogic';
import { BrandMark } from './BrandMark';

interface LandingPageProps {
  projects: Project[];
  onNewProject: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
}

const STUDIO_PREVIEW_SRC = './src/assets/images/trenveds_studio_preview_1795728659348.jpg';

export const LandingPage: React.FC<LandingPageProps> = ({
  projects,
  onNewProject,
  onOpenProject,
  onDeleteProject,
  onOpenSettings,
}) => {
  const [previewFailed, setPreviewFailed] = useState(false);

  return (
    <div className="studio-ambient-stage min-h-screen text-zinc-100 flex flex-col">
      {/* Top Navigation Bar — 3-Zone Contract */}
      <header className="studio-glass-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 h-16">
          <a
            href="#overview"
            className="focus-visible:outline-2 focus-visible:outline-red-500 rounded-md"
          >
            <BrandMark />
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
          >
            <a
              href="#overview"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-white"
            >
              Overview
            </a>
            <a
              href="#workflow"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-white"
            >
              Workspace
            </a>
            <a
              href="#projects"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-white"
            >
              Projects
            </a>
            <button
              type="button"
              onClick={onOpenSettings}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-red-500 rounded"
            >
              Settings
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Open Studio Settings"
              className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNewProject}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-[0_0_24px_-6px_rgba(220,38,38,0.65)] transition-colors hover:bg-red-500 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-400"
            >
              <Plus className="h-4 w-4" />
              <span>New Project</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* Hero / Introductory Section */}
        <section id="overview" className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 pb-16 md:pt-16 md:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <p className="text-sm font-medium text-red-400 tracking-wide">
                TRENVEDs V1.3 · AI Scene Studio
              </p>

              <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.08] [text-wrap:balance]">
                AI-powered video creation built with studio precision.
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-zinc-400">
                TRENVEDs brings conversational AI scene engineering, an isolated live viewport, and inspectable multi-file scene scripts into a focused production workspace. Start a project to direct and run scenes in real time.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={onNewProject}
                  className="inline-flex h-11 items-center gap-2.5 rounded-lg bg-red-600 px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(220,38,38,0.7)] transition-colors hover:bg-red-500 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-400"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Project</span>
                </button>
                <a
                  href="#workflow"
                  className="studio-glass-control inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium text-zinc-200 transition-all duration-150 hover:border-white/25 hover:bg-white/[0.08] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500"
                >
                  <span>Explore Studio</span>
                  <ArrowRight className="h-4 w-4 text-zinc-400" />
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-zinc-500">
                <span>Dark Glassmorphism Workspace</span>
                <span aria-hidden="true">·</span>
                <span>AI Brain &amp; Live Runtime</span>
                <span aria-hidden="true">·</span>
                <span>Bring Your Own API Key</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="studio-glass crimson-edge-left crimson-edge-right overflow-hidden rounded-xl p-2">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#090A0E]">
                  {!previewFailed ? (
                    <img
                      src={STUDIO_PREVIEW_SRC}
                      alt="TRENVEDs dark grading and video creation studio environment with subtle crimson edge illumination"
                      referrerPolicy="no-referrer"
                      onError={() => setPreviewFailed(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#0E1017] via-[#08090C] to-[#17090B] p-6 text-center">
                      <Clapperboard className="h-8 w-8 text-red-500/80" />
                      <p className="mt-3 text-sm font-medium text-zinc-200">
                        TRENVEDs Studio Suite
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        16:9 Cinema Workspace Preview
                      </p>
                    </div>
                  )}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/15"
                  />
                  <div className="absolute inset-x-4 bottom-3.5 flex items-center justify-between text-xs text-zinc-300">
                    <span className="font-medium text-white">Studio Workspace</span>
                    <span className="font-mono tabular-nums text-zinc-400">1920 × 1080 · 24 fps</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Studio Architecture / Workflow Breakdown */}
        <section
          id="workflow"
          className="border-t border-white/[0.07] bg-white/[0.015] py-14 md:py-16"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                Three synchronized studio surfaces
              </h2>
              <p className="mt-2.5 text-sm sm:text-base leading-relaxed text-zinc-400">
                Designed to keep visual framing at the center while conversational direction and readable scene code stay immediately accessible.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="studio-glass crimson-edge-left rounded-xl p-6">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium text-red-400">01. Direction</span>
                  <MessageSquare className="h-4 w-4 text-zinc-500" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  AI Chat Panel
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Draft scene briefs, pacing notes, and visual cues in a dedicated conversation lane built for iterative creative direction.
                </p>
              </div>

              <div className="studio-glass crimson-edge-both rounded-xl p-6">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium text-red-400">02. Canvas</span>
                  <Clapperboard className="h-4 w-4 text-zinc-500" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  Scene Viewport
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  A dark neutral framing stage supporting widescreen, vertical, square, and classic aspect ratios with zoom and safe-area guides.
                </p>
              </div>

              <div className="studio-glass crimson-edge-right rounded-xl p-6">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium text-red-400">03. Blueprint</span>
                  <Code2 className="h-4 w-4 text-zinc-500" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  AI Script Workspace
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Import, paste, and edit multi-file scene code with live syntax highlighting and explicit Viewport execution.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Projects Area (Empty State + Local Session Projects) */}
        <section id="projects" className="border-t border-white/[0.07] py-14 md:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-white">
                  Projects
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Local studio sessions created in this workspace.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="font-mono tabular-nums text-xs text-zinc-500">
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                </span>
                {projects.length > 0 && (
                  <button
                    type="button"
                    onClick={onNewProject}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.09] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500"
                  >
                    <Plus className="h-4 w-4 text-red-400" />
                    <span>New Project</span>
                  </button>
                )}
              </div>
            </div>

            {projects.length === 0 ? (
              <div
                data-testid="projects-empty-state"
                className="mt-6 studio-glass crimson-edge-left rounded-xl px-6 py-12 text-center"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-white">
                  No projects yet
                </h3>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-zinc-400">
                  Create a new project to launch the TRENVEDs Studio with a live scene viewport, AI direction chat, and real-time code inspector.
                </p>
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={onNewProject}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-red-400"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create First Project</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                data-testid="projects-grid"
                className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {projects.map((project) => {
                  const spec = getAspectRatioSpec(project.aspectRatio);
                  return (
                    <article
                      key={project.id}
                      className="studio-glass crimson-edge-left rounded-xl p-5 flex flex-col justify-between gap-4 transition-colors hover:border-white/15"
                    >
                      <div>
                        <h3 className="font-display text-base font-semibold text-white truncate">
                          {project.name}
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                          <span>{project.aspectRatio}</span>
                          <span aria-hidden="true">·</span>
                          <span>{spec.resolution}</span>
                          <span aria-hidden="true">·</span>
                          <span>{project.frameRate} fps</span>
                        </div>
                        <p className="mt-3 text-xs text-zinc-500">
                          Updated {formatShortTimestamp(project.updatedAt)} · {project.files.length}{' '}
                          {project.files.length === 1 ? 'file' : 'files'} · {project.messages.length}{' '}
                          {project.messages.length === 1 ? 'message' : 'messages'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-3.5">
                        <button
                          type="button"
                          onClick={() => onOpenProject(project.id)}
                          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-3.5 text-sm font-medium text-white transition-colors hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-red-500"
                        >
                          <span>Open Studio</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProject(project.id)}
                          aria-label={`Delete project ${project.name}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-600/10 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Quiet Studio Footer */}
      <footer className="border-t border-white/[0.07] py-8">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4 sm:px-6 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <BrandMark compact />
            <span>V1.3 AI Diagnostics &amp; Script Workspace</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-red-500 rounded"
            >
              Preferences
            </button>
            <button
              type="button"
              onClick={onNewProject}
              className="transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-red-500 rounded"
            >
              Launch Studio
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
