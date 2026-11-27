import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
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
  resolveProviderBaseUrl,
  testProviderConnection,
  validateProviderBaseUrl,
} from '../services/aiProviders';

export type SettingsTab = 'preferences' | 'providers';

type DiscoveryStatus = 'idle' | 'loading' | 'success' | 'error';

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
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle');
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState('');

  const discoverySeqRef = useRef(0);
  const discoveryAbortRef = useRef<AbortController | null>(null);

  const cancelOngoingDiscovery = useCallback(() => {
    discoverySeqRef.current += 1;
    discoveryAbortRef.current?.abort();
    discoveryAbortRef.current = null;
  }, []);

  const runModelDiscovery = useCallback(
    async (draftSnapshot: Pick<AiProviderConfig, 'id' | 'kind' | 'baseUrl' | 'apiKey'>) => {
      const preset = PROVIDER_PRESETS[draftSnapshot.kind];
      const resolvedUrl = resolveProviderBaseUrl(draftSnapshot);
      const urlCheck = validateProviderBaseUrl(resolvedUrl);

      if (!draftSnapshot.apiKey.trim()) {
        cancelOngoingDiscovery();
        setDiscoveryStatus('idle');
        setDiscoveryNotice(null);
        return;
      }

      if (preset.usesCustomEndpoint && !urlCheck.valid) {
        cancelOngoingDiscovery();
        setDiscoveryStatus('error');
        setDiscoveryNotice(urlCheck.error ?? 'Enter a valid HTTPS endpoint URL first.');
        return;
      }

      cancelOngoingDiscovery();
      const requestSeq = discoverySeqRef.current;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      discoveryAbortRef.current = controller;

      setDiscoveryStatus('loading');
      setDiscoveryNotice(`Retrieving available models from ${preset.label}...`);

      const result = await discoverProviderModels(
        {
          kind: draftSnapshot.kind,
          baseUrl: resolvedUrl,
          apiKey: draftSnapshot.apiKey,
        },
        fetch,
        controller?.signal
      );

      if (requestSeq !== discoverySeqRef.current || result.aborted) {
        return;
      }

      if (result.error) {
        setDiscoveryStatus('error');
        setDiscoveryNotice(result.error);
        return;
      }

      if (result.models.length === 0) {
        setDiscoveryStatus('success');
        setDiscoveryNotice(
          `No compatible models were returned by ${preset.label}. Enter a model identifier manually below.`
        );
        setEditingDraft((prev) =>
          prev && prev.id === draftSnapshot.id && prev.kind === draftSnapshot.kind
            ? { ...prev, discoveredModels: [] }
            : prev
        );
        return;
      }

      setDiscoveryStatus('success');
      setDiscoveryNotice(`Loaded ${result.models.length} models from ${preset.label}.`);
      setEditingDraft((prev) => {
        if (!prev || prev.id !== draftSnapshot.id || prev.kind !== draftSnapshot.kind) {
          return prev;
        }
        const currentModelValid =
          prev.model.trim() !== '' && result.models.includes(prev.model.trim());
        return {
          ...prev,
          discoveredModels: result.models,
          model: currentModelValid ? prev.model.trim() : result.models[0],
        };
      });
    },
    [cancelOngoingDiscovery]
  );

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setIsKeyRevealed(false);
      setModelFilter('');
      if (initialTab === 'providers' && providers.length === 0) {
        cancelOngoingDiscovery();
        setDiscoveryStatus('idle');
        setDiscoveryNotice(null);
        setEditingDraft(createEmptyProviderDraft('gemini'));
      } else {
        cancelOngoingDiscovery();
        setDiscoveryStatus('idle');
        setDiscoveryNotice(null);
        setEditingDraft(null);
      }
    } else {
      cancelOngoingDiscovery();
    }
  }, [isOpen, initialTab, providers.length, cancelOngoingDiscovery]);

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

  useEffect(() => {
    return () => cancelOngoingDiscovery();
  }, [cancelOngoingDiscovery]);

  // Auto-discover models when the user enters/pastes an API key (and valid custom URL if applicable)
  const draftId = editingDraft?.id ?? '';
  const draftKind = editingDraft?.kind ?? 'gemini';
  const draftBaseUrl = editingDraft?.baseUrl ?? '';
  const draftApiKey = editingDraft?.apiKey ?? '';
  const draftModelCount = editingDraft?.discoveredModels.length ?? 0;

  useEffect(() => {
    if (!isOpen || !draftId) return;
    const trimmedKey = draftApiKey.trim();
    if (!trimmedKey) {
      cancelOngoingDiscovery();
      setDiscoveryStatus('idle');
      setDiscoveryNotice(null);
      setEditingDraft((prev) =>
        prev && prev.id === draftId && prev.discoveredModels.length > 0
          ? { ...prev, discoveredModels: [] }
          : prev
      );
      return;
    }

    if (trimmedKey.length < 8) return;
    const preset = PROVIDER_PRESETS[draftKind];
    if (preset.usesCustomEndpoint && !validateProviderBaseUrl(draftBaseUrl).valid) {
      return;
    }
    if (draftModelCount > 0) return;

    const timer = window.setTimeout(() => {
      void runModelDiscovery({
        id: draftId,
        kind: draftKind,
        baseUrl: draftBaseUrl,
        apiKey: trimmedKey,
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    isOpen,
    draftId,
    draftKind,
    draftBaseUrl,
    draftApiKey,
    draftModelCount,
    cancelOngoingDiscovery,
    runModelDiscovery,
  ]);

  const filteredModels = useMemo(() => {
    if (!editingDraft) return [];
    const list = editingDraft.discoveredModels;
    const query = modelFilter.trim().toLowerCase();
    if (!query) return list;
    return list.filter((m) => m.toLowerCase().includes(query));
  }, [editingDraft, modelFilter]);

  if (!isOpen) return null;

  const handleStartNewProvider = () => {
    cancelOngoingDiscovery();
    setIsKeyRevealed(false);
    setDiscoveryStatus('idle');
    setDiscoveryNotice(null);
    setModelFilter('');
    setEditingDraft(createEmptyProviderDraft('gemini'));
  };

  const handleEditProvider = (provider: AiProviderConfig) => {
    cancelOngoingDiscovery();
    setIsKeyRevealed(false);
    setModelFilter('');
    const normalized: AiProviderConfig = {
      ...provider,
      baseUrl: resolveProviderBaseUrl(provider),
      discoveredModels: Array.isArray(provider.discoveredModels)
        ? [...provider.discoveredModels]
        : [],
    };
    setEditingDraft(normalized);
    if (normalized.discoveredModels.length > 0) {
      setDiscoveryStatus('success');
      setDiscoveryNotice(
        `Loaded ${normalized.discoveredModels.length} models from ${PROVIDER_PRESETS[normalized.kind].label}.`
      );
    } else {
      setDiscoveryStatus('idle');
      setDiscoveryNotice(null);
    }
  };

  const handleChangeKind = (nextKind: ProviderKind) => {
    if (!editingDraft || editingDraft.kind === nextKind) return;
    cancelOngoingDiscovery();
    const prevPreset = PROVIDER_PRESETS[editingDraft.kind];
    const nextPreset = PROVIDER_PRESETS[nextKind];
    const shouldReplaceName =
      !editingDraft.name.trim() || editingDraft.name === prevPreset.label;

    setDiscoveryStatus('idle');
    setDiscoveryNotice(null);
    setModelFilter('');
    setEditingDraft({
      ...editingDraft,
      kind: nextKind,
      name: shouldReplaceName ? nextPreset.label : editingDraft.name,
      baseUrl: nextPreset.usesCustomEndpoint ? '' : nextPreset.defaultBaseUrl,
      model: '',
      discoveredModels: [],
      lastTestStatus: 'untested',
      lastTestMessage: undefined,
    });
  };

  const handleDiscoverModels = async () => {
    if (!editingDraft || discoveryStatus === 'loading') return;
    await runModelDiscovery(editingDraft);
  };

  const handleTestConnection = async () => {
    if (!editingDraft || isTesting) return;
    setIsTesting(true);
    setEditingDraft((prev) =>
      prev ? { ...prev, lastTestStatus: 'testing', lastTestMessage: 'Testing connection...' } : null
    );

    const resolvedDraft: AiProviderConfig = {
      ...editingDraft,
      baseUrl: resolveProviderBaseUrl(editingDraft),
    };
    const result = await testProviderConnection(resolvedDraft);
    setIsTesting(false);

    setEditingDraft((prev) => {
      if (!prev || prev.id !== resolvedDraft.id) return prev;
      const updated: AiProviderConfig = {
        ...prev,
        baseUrl: resolvedDraft.baseUrl,
        lastTestStatus: result.status,
        lastTestMessage: result.message,
        lastTestedAt: result.testedAt,
        discoveredModels:
          result.discoveredModels && result.discoveredModels.length > 0
            ? result.discoveredModels
            : prev.discoveredModels,
      };
      if (providers.some((p) => p.id === updated.id)) {
        onSaveProvider(updated, false);
      }
      return updated;
    });
  };

  const handleSubmitDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDraft) return;
    const preset = PROVIDER_PRESETS[editingDraft.kind];
    const resolvedUrl = resolveProviderBaseUrl(editingDraft);
    if (preset.usesCustomEndpoint && !validateProviderBaseUrl(resolvedUrl).valid) {
      return;
    }
    const cleaned: AiProviderConfig = {
      ...editingDraft,
      name: editingDraft.name.trim() || preset.label,
      baseUrl: resolvedUrl,
      model: editingDraft.model.trim(),
      apiKey: editingDraft.apiKey.trim(),
    };
    if (!cleaned.model || !cleaned.baseUrl || !cleaned.apiKey) return;
    onSaveProvider(cleaned, providers.length === 0 || activeProviderId === cleaned.id);
    cancelOngoingDiscovery();
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
              {editingDraft && (() => {
                const activePreset = PROVIDER_PRESETS[editingDraft.kind];
                const hasDiscoveredModels = editingDraft.discoveredModels.length > 0;
                const showManualFallback =
                  !activePreset.supportsModelDiscovery ||
                  discoveryStatus === 'error' ||
                  (discoveryStatus === 'success' && !hasDiscoveredModels) ||
                  (!hasDiscoveredModels && editingDraft.model.trim() !== '');
                const canRefreshModels =
                  discoveryStatus !== 'loading' &&
                  editingDraft.apiKey.trim().length > 0 &&
                  (!activePreset.usesCustomEndpoint || validateProviderBaseUrl(editingDraft.baseUrl).valid);

                return (
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
                        onClick={() => {
                          cancelOngoingDiscovery();
                          setEditingDraft(null);
                        }}
                        className="text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        Back to list
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Provider
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PROVIDER_KINDS.map((kind) => {
                        const preset = PROVIDER_PRESETS[kind];
                        const selected = editingDraft.kind === kind;
                        return (
                          <button
                            key={kind}
                            type="button"
                            aria-pressed={selected}
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

                  {activePreset.usesCustomEndpoint && (
                    <div>
                      <label htmlFor="provider-url-input" className="block text-xs font-medium text-zinc-300 mb-1">
                        Endpoint Base URL
                      </label>
                      <input
                        id="provider-url-input"
                        type="url"
                        required
                        value={editingDraft.baseUrl}
                        onChange={(e) => {
                          cancelOngoingDiscovery();
                          setDiscoveryStatus('idle');
                          setDiscoveryNotice(null);
                          setEditingDraft({
                            ...editingDraft,
                            baseUrl: e.target.value,
                            discoveredModels: [],
                            lastTestStatus: 'untested',
                            lastTestMessage: undefined,
                          });
                        }}
                        placeholder={activePreset.urlPlaceholder ?? 'https://api.example.com/v1'}
                        className="h-9 w-full rounded-lg border border-white/10 bg-black/45 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                      />
                    </div>
                  )}

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
                        onChange={(e) => {
                          cancelOngoingDiscovery();
                          setDiscoveryStatus('idle');
                          setDiscoveryNotice(null);
                          setEditingDraft({
                            ...editingDraft,
                            apiKey: e.target.value,
                            discoveredModels: [],
                            lastTestStatus: 'untested',
                            lastTestMessage: undefined,
                          });
                        }}
                        placeholder={activePreset.keyPlaceholder}
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
                      <label
                        htmlFor={showManualFallback ? 'provider-model-input' : 'provider-model-filter'}
                        className="block text-xs font-medium text-zinc-300"
                      >
                        Model
                      </label>
                      {activePreset.supportsModelDiscovery && (
                        <button
                          type="button"
                          onClick={handleDiscoverModels}
                          disabled={!canRefreshModels}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-300 hover:text-red-200 disabled:opacity-40"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${discoveryStatus === 'loading' ? 'animate-spin' : ''}`}
                          />
                          <span>
                            {discoveryStatus === 'loading' ? 'Refreshing...' : 'Refresh Models'}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Discovery Status Indicator */}
                    {discoveryStatus === 'loading' && (
                      <div
                        data-testid="model-discovery-status"
                        data-status="loading"
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300"
                      >
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-red-400" />
                        <span>{discoveryNotice ?? 'Retrieving available models...'}</span>
                      </div>
                    )}

                    {discoveryStatus === 'error' && discoveryNotice && (
                      <div
                        data-testid="model-discovery-status"
                        data-status="error"
                        className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-600/10 px-3 py-2 text-xs text-red-200"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                        <span className="break-words">{discoveryNotice}</span>
                      </div>
                    )}

                    {discoveryStatus === 'success' && discoveryNotice && (
                      <div
                        data-testid="model-discovery-status"
                        data-status="success"
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[11px] ${
                          hasDiscoveredModels
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                            : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {hasDiscoveredModels ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">{discoveryNotice}</span>
                        </span>
                        {editingDraft.model && (
                          <span className="font-mono text-[10px] text-zinc-200 truncate max-w-[45%]">
                            {editingDraft.model}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Complete Browsable Model List from Provider API */}
                    {hasDiscoveredModels && (
                      <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-1.5 bg-white/[0.02]">
                          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                          <input
                            id="provider-model-filter"
                            type="search"
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            placeholder={`Browse all ${editingDraft.discoveredModels.length} models...`}
                            aria-label="Filter available models"
                            className="h-7 w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                          />
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                            {filteredModels.length}/{editingDraft.discoveredModels.length}
                          </span>
                        </div>

                        <div
                          role="listbox"
                          aria-label="Available models"
                          data-testid="discovered-model-list"
                          className="studio-scroll max-h-44 overflow-y-auto p-1.5 space-y-0.5"
                        >
                          {filteredModels.length === 0 ? (
                            <p className="px-2.5 py-3 text-center text-xs text-zinc-500">
                              No models match "{modelFilter}".
                            </p>
                          ) : (
                            filteredModels.map((modelId) => {
                              const selected = editingDraft.model === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() =>
                                    setEditingDraft({
                                      ...editingDraft,
                                      model: modelId,
                                      lastTestStatus: 'untested',
                                      lastTestMessage: undefined,
                                    })
                                  }
                                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                                    selected
                                      ? 'border border-red-500/50 bg-red-600/20 text-white'
                                      : 'border border-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                                  }`}
                                >
                                  <span className="truncate">{modelId}</span>
                                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* Idle Prompt before API key is entered */}
                    {!hasDiscoveredModels &&
                      discoveryStatus === 'idle' &&
                      !showManualFallback && (
                        <div
                          data-testid="model-discovery-status"
                          data-status="idle"
                          className="rounded-lg border border-dashed border-white/10 bg-black/25 px-3 py-2.5 text-xs text-zinc-400"
                        >
                          Enter your API key above to retrieve the full list of available models from{' '}
                          {activePreset.label}.
                        </div>
                      )}

                    {/* Manual Model Identifier Fallback (only when discovery fails/unsupported or returns empty) */}
                    {showManualFallback && (
                      <div className="space-y-1">
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
                          placeholder="Enter model identifier manually"
                          aria-label="Manual model identifier"
                          className="h-9 w-full rounded-lg border border-white/10 bg-black/45 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
                        />
                        <p className="text-[11px] text-zinc-500">
                          Manual model entry fallback active. Refresh models after fixing key or endpoint if needed.
                        </p>
                      </div>
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
                        disabled={
                          !editingDraft.apiKey.trim() ||
                          !editingDraft.model.trim() ||
                          (activePreset.usesCustomEndpoint &&
                            !validateProviderBaseUrl(editingDraft.baseUrl).valid)
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Save Provider</span>
                      </button>
                    </div>
                  </div>
                </form>
                );
              })()}
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
