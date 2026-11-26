import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AspectRatio,
  FrameRate,
  ProviderKind,
  StudioSettings,
} from '../types/studio';
import {
  PROVIDER_PRESETS,
  createEmptyProviderDraft,
  discoverProviderModels,
  getPersistenceLabel,
  maskApiKey,
  testProviderConnection,
} from '../services/aiProviders';

export type SettingsTab = 'preferences' | 'providers';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTab;
  settings: StudioSettings;
  providers: AiProviderConfig[];
  activeProviderId: string | null;
  onUpdateSettings: (next: StudioSettings) => void;
  onSaveProvider: (provider: AiProviderConfig, setAsActive?: boolean) => void;
  onDeleteProvider: (providerId: string) => void;
  onSelectActiveProvider: (providerId: string) => void;
  onClose: () => void;
}

const ASPECT_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3'];
const FRAME_RATES: FrameRate[] = [24, 30, 60];
const PROVIDER_KINDS: ProviderKind[] = ['gemini', 'openai', 'anthropic', 'openai-compatible'];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'preferences',
  settings,
  providers,
  activeProviderId,
  onUpdateSettings,
  onSaveProvider,
  onDeleteProvider,
  onSelectActiveProvider,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [editingDraft, setEditingDraft] = useState<AiProviderConfig | null>(null);
  const [isKeyRevealed, setIsKeyRevealed] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setIsKeyRevealed(false);
      setDiscoveryNotice(null);
      if (initialTab === 'providers' && providers.length === 0) {
        setEditingDraft(createEmptyProviderDraft('gemini'));
      } else {
        setEditingDraft(null);
      }
    }
  }, [isOpen, initialTab, providers.length]);

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

  const handleStartNewProvider = () => {
    setIsKeyRevealed(false);
    setDiscoveryNotice(null);
    setEditingDraft(createEmptyProviderDraft('gemini'));
  };

  const handleEditProvider = (provider: AiProviderConfig) => {
    setIsKeyRevealed(false);
    setDiscoveryNotice(null);
    setEditingDraft({ ...provider });
  };

  const handleChangeKind = (nextKind: ProviderKind) => {
    if (!editingDraft) return;
    const prevPreset = PROVIDER_PRESETS[editingDraft.kind];
    const nextPreset = PROVIDER_PRESETS[nextKind];
    const shouldReplaceName =
      !editingDraft.name.trim() || editingDraft.name === prevPreset.label;
    const shouldReplaceUrl =
      !editingDraft.baseUrl.trim() || editingDraft.baseUrl === prevPreset.defaultBaseUrl;
    const shouldReplaceModel =
      !editingDraft.model.trim() || editingDraft.model === prevPreset.defaultModel;

    setDiscoveryNotice(null);
    setEditingDraft({
      ...editingDraft,
      kind: nextKind,
      name: shouldReplaceName ? nextPreset.label : editingDraft.name,
      baseUrl: shouldReplaceUrl ? nextPreset.defaultBaseUrl : editingDraft.baseUrl,
      model: shouldReplaceModel ? nextPreset.defaultModel : editingDraft.model,
      discoveredModels: [],
      lastTestStatus: 'untested',
      lastTestMessage: undefined,
    });
  };

  const handleDiscoverModels = async () => {
    if (!editingDraft || isDiscovering) return;
    setIsDiscovering(true);
    setDiscoveryNotice(null);
    const result = await discoverProviderModels(editingDraft);
    setIsDiscovering(false);

    if (result.error) {
      setDiscoveryNotice(result.error);
      return;
    }

    if (result.models.length === 0) {
      setDiscoveryNotice('No compatible models returned; enter model ID manually.');
      return;
    }

    setEditingDraft((prev) =>
      prev
        ? {
            ...prev,
            discoveredModels: result.models,
            model: prev.model.trim() || result.models[0],
          }
        : null
    );
    setDiscoveryNotice(`Loaded ${result.models.length} models.`);
  };

  const handleTestConnection = async () => {
    if (!editingDraft || isTesting) return;
    setIsTesting(true);
    setEditingDraft((prev) =>
      prev ? { ...prev, lastTestStatus: 'testing', lastTestMessage: 'Testing connection...' } : null
    );

    const result = await testProviderConnection(editingDraft);
    setIsTesting(false);

    setEditingDraft((prev) => {
      if (!prev) return null;
      const updated: AiProviderConfig = {
        ...prev,
        lastTestStatus: result.status,
        lastTestMessage: result.message,
        lastTestedAt: result.testedAt,
        discoveredModels:
          result.discoveredModels && result.discoveredModels.length > 0
            ? result.discoveredModels
            : prev.discoveredModels,
      };
      // If editing an existing saved provider, update its tested state immediately
      if (providers.some((p) => p.id === updated.id)) {
        onSaveProvider(updated, false);
      }
      return updated;
    });
  };

  const handleSubmitDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDraft) return;
    const cleaned: AiProviderConfig = {
      ...editingDraft,
      name: editingDraft.name.trim() || PROVIDER_PRESETS[editingDraft.kind].label,
      baseUrl: editingDraft.baseUrl.trim().replace(/\/+$/, ''),
      model: editingDraft.model.trim(),
      apiKey: editingDraft.apiKey.trim(),
    };
    if (!cleaned.model || !cleaned.baseUrl) return;
    onSaveProvider(cleaned, providers.length === 0 || activeProviderId === cleaned.id);
    setEditingDraft(null);
    setIsKeyRevealed(false);
  };

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
        aria-labelledby="settings-dialog-title"
        className="studio-glass-elevated studio-dialog-panel crimson-edge-left flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl text-zinc-100"
      >
        {/* Header & Tab Strip */}
        <div className="shrink-0 border-b border-white/10 px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="settings-dialog-title" className="text-lg font-semibold tracking-tight text-white">
                Studio Settings
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Configure workspace defaults and your own AI provider credentials.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Settings sections"
            className="studio-glass-control mt-4 inline-flex rounded-lg p-1 gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'preferences'}
              onClick={() => setActiveTab('preferences')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all whitespace-nowrap ${
                activeTab === 'preferences'
                  ? 'border border-red-500/45 bg-red-600/20 text-white'
                  : 'border border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Studio Preferences</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'providers'}
              onClick={() => setActiveTab('providers')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all whitespace-nowrap ${
                activeTab === 'providers'
                  ? 'border border-red-500/45 bg-red-600/20 text-white'
                  : 'border border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>AI Providers ({providers.length})</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="studio-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {activeTab === 'preferences' ? (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-200">
                  Default Aspect Ratio
                </label>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {ASPECT_RATIOS.map((ratio) => {
                    const active = settings.defaultAspectRatio === ratio;
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ ...settings, defaultAspectRatio: ratio })
                        }
                        className={`h-10 rounded-lg border font-mono text-xs transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
                          active
                            ? 'border-red-500/70 bg-red-600/15 text-white'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                        }`}
                      >
                        {ratio}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-200">
                  Default Frame Rate
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {FRAME_RATES.map((fps) => {
                    const active = settings.defaultFrameRate === fps;
                    return (
                      <button
                        key={fps}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ ...settings, defaultFrameRate: fps })
                        }
                        className={`h-10 rounded-lg border font-mono text-xs transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-red-500 ${
                          active
                            ? 'border-red-500/70 bg-red-600/15 text-white'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                        }`}
                      >
                        {fps} fps
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 border-t border-white/10 pt-4">
                <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
                  <div>
                    <span className="block text-sm font-medium text-zinc-200">
                      Show safe-area guides
                    </span>
                    <span className="block text-xs text-zinc-400">
                      Display framing crosshairs and margin guides in the Scene Viewport.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showGuidesByDefault}
                    onChange={(event) =>
                      onUpdateSettings({
                        ...settings,
                        showGuidesByDefault: event.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-red-600 rounded"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
                  <div>
                    <span className="block text-sm font-medium text-zinc-200">
                      Script line numbers
                    </span>
                    <span className="block text-xs text-zinc-400">
                      Show line numbers in the read-only AI Script viewer.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showLineNumbers}
                    onChange={(event) =>
                      onUpdateSettings({
                        ...settings,
                        showLineNumbers: event.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-red-600 rounded"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Saved Providers List */}
              {!editingDraft && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-400">
                      Requests connect directly from your browser to your selected AI provider.
                    </p>
                    <button
                      type="button"
                      onClick={handleStartNewProvider}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Provider</span>
                    </button>
                  </div>

                  {providers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/25 p-6 text-center space-y-2">
                      <KeyRound className="mx-auto h-6 w-6 text-red-400" />
                      <h3 className="text-sm font-medium text-zinc-100">
                        No AI provider configured
                      </h3>
                      <p className="mx-auto max-w-sm text-xs leading-relaxed text-zinc-400">
                        Add an API key for Google Gemini, OpenAI, Anthropic, or an OpenAI-compatible endpoint to enable real AI scene creation.
                      </p>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleStartNewProvider}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-medium text-white hover:bg-red-500"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Configure First Provider</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {providers.map((provider) => {
                        const isActive = provider.id === activeProviderId;
                        return (
                          <div
                            key={provider.id}
                            data-testid={`provider-card-${provider.id}`}
                            className={`rounded-xl border p-3.5 transition-colors ${
                              isActive
                                ? 'border-red-500/45 bg-red-600/[0.08]'
                                : 'border-white/10 bg-white/[0.03]'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-white truncate">
                                    {provider.name}
                                  </span>
                                  {isActive && (
                                    <span className="rounded border border-red-500/40 bg-red-600/20 px-1.5 py-0.5 text-[10px] font-medium text-red-200">
                                      Active
                                    </span>
                                  )}
                                  <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                                    {getPersistenceLabel(provider.persistence)}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-zinc-400">
                                  <span>{provider.model}</span>
                                  <span>Key: {maskApiKey(provider.apiKey)}</span>
                                </div>

                                {provider.lastTestStatus !== 'untested' && (
                                  <p
                                    className={`flex items-center gap-1.5 text-[11px] ${
                                      provider.lastTestStatus === 'connected'
                                        ? 'text-emerald-300'
                                        : provider.lastTestStatus === 'error'
                                          ? 'text-red-300'
                                          : 'text-amber-300'
                                    }`}
                                  >
                                    {provider.lastTestStatus === 'connected' ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <span>{provider.lastTestMessage}</span>
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {!isActive && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectActiveProvider(provider.id)}
                                    className="studio-glass-control h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-200 hover:border-red-500/45 hover:text-white"
                                  >
                                    Set Active
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleEditProvider(provider)}
                                  className="studio-glass-control h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-300 hover:text-white"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteProvider(provider.id)}
                                  aria-label={`Remove provider ${provider.name}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-400 hover:border-red-500/40 hover:bg-red-600/15 hover:text-red-300"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Add / Edit Provider Form */}
              {editingDraft && (
                <form onSubmit={handleSubmitDraft} className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <h3 className="text-sm font-semibold text-white">
                      {providers.some((p) => p.id === editingDraft.id)
                        ? 'Edit AI Provider'
                        : 'Configure AI Provider'}
                    </h3>
                    {providers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingDraft(null)}
                        className="text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        Back to list
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Provider Type
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PROVIDER_KINDS.map((kind) => {
                        const preset = PROVIDER_PRESETS[kind];
                        const selected = editingDraft.kind === kind;
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => handleChangeKind(kind)}
                            className={`h-9 rounded-lg border px-2 text-xs font-medium transition-colors truncate ${
                              selected
                                ? 'border-red-500/60 bg-red-600/20 text-white'
                                : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="provider-name-input" className="block text-xs font-medium text-zinc-300 mb-1">
                        Display Name
                      </label>
                      <input
                        id="provider-name-input"
                        type="text"
                        value={editingDraft.name}
                        onChange={(e) =>
                          setEditingDraft({ ...editingDraft, name: e.target.value })
                        }
                        placeholder="My Gemini Key"
                        className="h-9 w-full rounded-lg border border-white/10 bg-black/45 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="provider-url-input" className="block text-xs font-medium text-zinc-300 mb-1">
                        Endpoint Base URL
                      </label>
                      <input
                        id="provider-url-input"
                        type="url"
                        required
                        value={editingDraft.baseUrl}
                        onChange={(e) =>
                          setEditingDraft({
                            ...editingDraft,
                            baseUrl: e.target.value,
                            lastTestStatus: 'untested',
                            lastTestMessage: undefined,
                          })
                        }
                        className="h-9 w-full rounded-lg border border-white/10 bg-black/45 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="provider-apikey-input" className="block text-xs font-medium text-zinc-300 mb-1">
                      API Key
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="provider-apikey-input"
                        type={isKeyRevealed ? 'text' : 'password'}
                        required
                        autoComplete="off"
                        spellCheck={false}
                        value={editingDraft.apiKey}
                        onChange={(e) =>
                          setEditingDraft({
                            ...editingDraft,
                            apiKey: e.target.value,
                            lastTestStatus: 'untested',
                            lastTestMessage: undefined,
                          })
                        }
                        placeholder={PROVIDER_PRESETS[editingDraft.kind].keyPlaceholder}
                        className="h-9 flex-1 rounded-lg border border-white/10 bg-black/45 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setIsKeyRevealed((prev) => !prev)}
                        aria-label={isKeyRevealed ? 'Hide API key' : 'Reveal API key'}
                        className="studio-glass-control inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:text-white"
                      >
                        {isKeyRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="provider-model-input" className="block text-xs font-medium text-zinc-300">
                        Model ID
                      </label>
                      {PROVIDER_PRESETS[editingDraft.kind].supportsModelDiscovery && (
                        <button
                          type="button"
                          onClick={handleDiscoverModels}
                          disabled={isDiscovering || !editingDraft.apiKey.trim()}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300 hover:text-red-200 disabled:opacity-40"
                        >
                          <RefreshCw className={`h-3 w-3 ${isDiscovering ? 'animate-spin' : ''}`} />
                          <span>{isDiscovering ? 'Fetching models...' : 'Fetch Models'}</span>
                        </button>
                      )}
                    </div>

                    <input
                      id="provider-model-input"
                      type="text"
                      required
                      value={editingDraft.model}
                      onChange={(e) =>
                        setEditingDraft({
                          ...editingDraft,
                          model: e.target.value,
                          lastTestStatus: 'untested',
                          lastTestMessage: undefined,
                        })
                      }
                      placeholder={PROVIDER_PRESETS[editingDraft.kind].defaultModel}
                      className="h-9 w-full rounded-lg border border-white/10 bg-black/45 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                    />

                    {(editingDraft.discoveredModels.length > 0 ||
                      PROVIDER_PRESETS[editingDraft.kind].suggestedModels.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-zinc-500">
                          {editingDraft.discoveredModels.length > 0 ? 'Available:' : 'Common:'}
                        </span>
                        {(editingDraft.discoveredModels.length > 0
                          ? editingDraft.discoveredModels.slice(0, 8)
                          : PROVIDER_PRESETS[editingDraft.kind].suggestedModels
                        ).map((modelId) => (
                          <button
                            key={modelId}
                            type="button"
                            onClick={() =>
                              setEditingDraft({
                                ...editingDraft,
                                model: modelId,
                                lastTestStatus: 'untested',
                                lastTestMessage: undefined,
                              })
                            }
                            className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                              editingDraft.model === modelId
                                ? 'border-red-500/50 bg-red-600/20 text-white'
                                : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {modelId}
                          </button>
                        ))}
                      </div>
                    )}

                    {discoveryNotice && (
                      <p className="text-[11px] text-zinc-400">{discoveryNotice}</p>
                    )}
                  </div>

                  {/* Credential Storage Choice */}
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3.5 space-y-2.5">
                    <span className="block text-xs font-medium text-zinc-200">
                      API Key Storage
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingDraft({ ...editingDraft, persistence: 'session' })
                        }
                        className={`rounded-lg border p-2.5 text-left text-xs transition-colors ${
                          editingDraft.persistence === 'session'
                            ? 'border-red-500/50 bg-red-600/15 text-white'
                            : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div className="font-medium">Session only (Recommended)</div>
                        <div className="mt-0.5 text-[11px] text-zinc-400">
                          Cleared automatically when this browser tab closes.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setEditingDraft({ ...editingDraft, persistence: 'local' })
                        }
                        className={`rounded-lg border p-2.5 text-left text-xs transition-colors ${
                          editingDraft.persistence === 'local'
                            ? 'border-amber-500/50 bg-amber-500/15 text-white'
                            : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div className="font-medium">Remember in browser</div>
                        <div className="mt-0.5 text-[11px] text-zinc-400">
                          Persists in localStorage across browser restarts.
                        </div>
                      </button>
                    </div>

                    {editingDraft.persistence === 'local' && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Browser localStorage stays readable by scripts on this origin across sessions. Use session-only storage on shared or untrusted devices.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Test Connection Result */}
                  {editingDraft.lastTestMessage && (
                    <div
                      data-testid="connection-test-result"
                      data-status={editingDraft.lastTestStatus}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                        editingDraft.lastTestStatus === 'connected'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          : editingDraft.lastTestStatus === 'error'
                            ? 'border-red-500/45 bg-red-600/15 text-red-200'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      {editingDraft.lastTestStatus === 'testing' ? (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                      ) : editingDraft.lastTestStatus === 'connected' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span className="break-words">{editingDraft.lastTestMessage}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting || !editingDraft.apiKey.trim() || !editingDraft.model.trim()}
                      className="studio-glass-control inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium text-zinc-200 hover:border-red-500/45 hover:text-white disabled:opacity-40"
                    >
                      {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Test Connection</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {providers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditingDraft(null)}
                          className="h-9 rounded-lg border border-white/10 px-3.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={!editingDraft.apiKey.trim() || !editingDraft.model.trim() || !editingDraft.baseUrl.trim()}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Save Provider</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/25 px-6 py-3.5">
          <span className="text-[11px] text-zinc-500">
            TRENVEDs V1.2 · Credentials remain on your device
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg bg-white/10 px-4 text-xs font-medium text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-red-400"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
