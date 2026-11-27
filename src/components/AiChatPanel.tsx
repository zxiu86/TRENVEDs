import React, { useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react';
import { PROMPT_SUGGESTIONS } from '../data/staticScripts';
import type {
  ActivityRun,
  AiProviderConfig,
  AiStatus,
  ChatMessage,
} from '../types/studio';
import { formatShortTimestamp } from '../utils/studioLogic';
import { ActivityReportCard } from './ActivityReportCard';

interface AiChatPanelProps {
  messages: ChatMessage[];
  activityRuns: ActivityRun[];
  activeRun: ActivityRun | null;
  activeProvider: AiProviderConfig | null;
  aiStatus: AiStatus;
  onSendMessage: (content: string) => void;
  onClearMessages: () => void;
  onOpenAiSettings: () => void;
  onSelectFile?: (path: string) => void;
  onCollapse?: () => void;
}

const STATUS_DISPLAY: Record<AiStatus, { label: string; toneClass: string }> = {
  idle: {
    label: 'Ready',
    toneClass: 'text-zinc-400 border-white/10 bg-white/[0.03]',
  },
  planning: {
    label: 'Planning',
    toneClass: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  },
  diagnosing: {
    label: 'Diagnosing',
    toneClass: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  },
  researching: {
    label: 'Researching',
    toneClass: 'text-sky-300 border-sky-500/35 bg-sky-500/10',
  },
  thinking: {
    label: 'Thinking',
    toneClass: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  },
  reviewing: {
    label: 'Reviewing',
    toneClass: 'text-amber-200 border-amber-500/35 bg-amber-500/10',
  },
  generating: {
    label: 'Writing',
    toneClass: 'text-red-300 border-red-500/40 bg-red-600/15',
  },
  compiling: {
    label: 'Running',
    toneClass: 'text-sky-300 border-sky-500/35 bg-sky-500/10',
  },
  repairing: {
    label: 'Repairing',
    toneClass: 'text-amber-300 border-amber-500/40 bg-amber-500/15',
  },
};

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  messages,
  activityRuns,
  activeRun,
  activeProvider,
  aiStatus,
  onSendMessage,
  onClearMessages,
  onOpenAiSettings,
  onSelectFile,
  onCollapse,
}) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activityRuns, activeRun, aiStatus]);

  const isBusy = aiStatus !== 'idle';
  const statusInfo = STATUS_DISPLAY[aiStatus];

  const handleSubmit = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    if (!activeProvider || !activeProvider.apiKey.trim()) {
      onOpenAiSettings();
      return;
    }
    setInput('');
    onSendMessage(trimmed);
  };

  return (
    <section
      aria-label="AI Direction Chat"
      className="studio-glass crimson-edge-left flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-all duration-200 ease-out"
    >
      {/* Panel Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-red-400" />
          <h2 className="font-display text-xs font-semibold tracking-wide text-zinc-100 truncate">
            AI Direction
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            data-testid="ai-status-indicator"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${statusInfo.toneClass}`}
          >
            {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
            <span>{statusInfo.label}</span>
          </span>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearMessages}
              disabled={isBusy}
              title="Reset conversation"
              aria-label="Reset conversation"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse AI Chat panel"
              aria-label="Collapse AI Chat panel"
              className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Active Provider Bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-black/20 px-3.5 py-1.5 text-[11px]">
        {activeProvider ? (
          <>
            <span className="truncate font-mono text-zinc-400">
              {activeProvider.name} · <span className="text-zinc-200">{activeProvider.model}</span>
            </span>
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="shrink-0 text-zinc-400 hover:text-red-300 transition-colors"
            >
              Switch
            </button>
          </>
        ) : (
          <>
            <span className="truncate text-amber-300/90">No AI provider configured</span>
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-red-500/40 bg-red-600/15 px-2 py-0.5 text-[10px] font-medium text-red-200 hover:bg-red-600/25"
            >
              <KeyRound className="h-3 w-3" />
              <span>Configure AI</span>
            </button>
          </>
        )}
      </div>

      {/* Chat History & Work Reports */}
      <div
        ref={scrollRef}
        data-testid="chat-history"
        className="studio-scroll flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-between gap-5 py-2">
            <div className="space-y-2.5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/25 bg-red-600/10 text-red-400">
                <Sparkles className="h-4 w-4" />
              </div>
              <h3 className="font-display text-sm font-semibold text-white">
                Direct your scene in plain language
              </h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                Describe motion, lighting, 3D geometry, or typographic animation. TRENVEDs plans the architecture, writes scene files into the Script viewer, and executes them live in the Viewport.
              </p>

              {!activeProvider && (
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/45 bg-red-600/15 px-3 py-2 text-xs font-medium text-red-100 hover:bg-red-600/25"
                >
                  <KeyRound className="h-3.5 w-3.5 text-red-400" />
                  <span>Add AI Provider API Key</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium text-zinc-500">
                Scene prompts
              </p>
              <div className="space-y-1.5">
                {PROMPT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      if (!activeProvider) {
                        setInput(suggestion);
                        onOpenAiSettings();
                        return;
                      }
                      onSendMessage(suggestion);
                    }}
                    className="studio-glass-control w-full rounded-lg px-3 py-2 text-left text-xs leading-snug text-zinc-300 transition-all duration-150 hover:border-red-500/45 hover:bg-red-600/15 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-red-500"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === 'user';
            const linkedRun = message.activityRunId
              ? activityRuns.find((r) => r.id === message.activityRunId)
              : undefined;

            return (
              <div
                key={message.id}
                className={`studio-view-enter flex flex-col gap-2 ${
                  isUser ? 'items-end' : 'items-stretch'
                }`}
              >
                {linkedRun && (
                  <ActivityReportCard run={linkedRun} onSelectFile={onSelectFile} />
                )}

                <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[94%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isUser
                        ? 'border border-red-500/35 bg-red-950/40 text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : message.isError
                          ? 'border border-red-500/45 bg-red-950/35 text-red-100'
                          : 'studio-glass-control crimson-edge-left text-zinc-200'
                    }`}
                  >
                    {message.content}
                  </div>
                  <span className="mt-1 px-1 text-[10px] text-zinc-500 font-mono tabular-nums">
                    {isUser ? 'Director' : 'TRENVEDs AI'} · {formatShortTimestamp(message.timestamp)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {activeRun && (
          <div className="studio-view-enter">
            <ActivityReportCard run={activeRun} onSelectFile={onSelectFile} />
          </div>
        )}
      </div>

      {/* Message Input Area */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-white/[0.08] bg-black/25 p-3"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="studio-chat-input" className="sr-only">
            Scene direction message
          </label>
          <textarea
            id="studio-chat-input"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              activeProvider
                ? 'Describe a scene, animation, or modification...'
                : 'Configure an AI provider in Settings to direct scenes...'
            }
            className="studio-scroll min-h-[44px] max-h-28 flex-1 resize-none rounded-lg border border-white/10 bg-[#070709]/80 px-3 py-2 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            aria-label="Send message"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition-colors hover:bg-red-500 disabled:bg-white/10 disabled:text-zinc-500 focus-visible:outline-2 focus-visible:outline-red-400"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-500">
          {activeProvider
            ? `${activeProvider.name} · Enter to generate, Shift+Enter for newline`
            : 'Add your API key in Settings → AI Providers to begin'}
        </p>
      </form>
    </section>
  );
};
