import type {
  AiProviderConfig,
  ConnectionTestStatus,
  CredentialPersistence,
  ProviderKind,
} from '../types/studio';

const SESSION_STORAGE_KEY = 'trenveds_ai_providers_session_v1';
const LOCAL_STORAGE_KEY = 'trenveds_ai_providers_local_v1';
const ACTIVE_PROVIDER_KEY = 'trenveds_active_ai_provider_id_v1';

export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  defaultBaseUrl: string;
  usesCustomEndpoint: boolean;
  urlPlaceholder?: string;
  defaultModel: string;
  supportsModelDiscovery: boolean;
  keyPlaceholder: string;
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    usesCustomEndpoint: false,
    defaultModel: '',
    supportsModelDiscovery: true,
    keyPlaceholder: 'AIza...',
  },
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    usesCustomEndpoint: false,
    defaultModel: '',
    supportsModelDiscovery: true,
    keyPlaceholder: 'sk-...',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    usesCustomEndpoint: false,
    defaultModel: '',
    supportsModelDiscovery: true,
    keyPlaceholder: 'sk-ant-...',
  },
  'openai-compatible': {
    kind: 'openai-compatible',
    label: 'OpenAI-Compatible',
    defaultBaseUrl: '',
    usesCustomEndpoint: true,
    urlPlaceholder: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    supportsModelDiscovery: true,
    keyPlaceholder: 'Provider API key',
  },
};

export interface ConnectionTestResult {
  status: Extract<ConnectionTestStatus, 'connected' | 'error'>;
  message: string;
  discoveredModels?: string[];
  testedAt: string;
}

export interface ModelDiscoveryResult {
  models: string[];
  error?: string;
  aborted?: boolean;
}

export interface ProviderChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderCompletionRequest {
  systemPrompt: string;
  messages: ProviderChatMessage[];
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
  signal?: AbortSignal;
}

export function resolveProviderBaseUrl(
  provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>
): string {
  const preset = PROVIDER_PRESETS[provider.kind];
  if (!preset.usesCustomEndpoint) {
    return preset.defaultBaseUrl;
  }
  return provider.baseUrl.trim().replace(/\/+$/, '');
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return 'Not configured';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}`;
}

export function validateProviderBaseUrl(rawUrl: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Endpoint base URL is required.' };
  }
  try {
    const parsed = new URL(trimmed);
    const isLocalHost =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost)) {
      return {
        valid: false,
        normalized: trimmed,
        error: 'Endpoint URL must use HTTPS (or HTTP only for localhost).',
      };
    }
    return { valid: true, normalized: parsed.toString().replace(/\/+$/, '') };
  } catch {
    return { valid: false, normalized: trimmed, error: 'Invalid endpoint URL format.' };
  }
}

export function createEmptyProviderDraft(kind: ProviderKind = 'gemini'): AiProviderConfig {
  const preset = PROVIDER_PRESETS[kind];
  return {
    id: `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: preset.label,
    kind,
    baseUrl: preset.usesCustomEndpoint ? '' : preset.defaultBaseUrl,
    model: '',
    apiKey: '',
    persistence: 'session',
    discoveredModels: [],
    lastTestStatus: 'untested',
  };
}

function safeReadJson<T>(storage: Storage | undefined, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeLoadedProvider(
  item: AiProviderConfig,
  persistence: CredentialPersistence
): AiProviderConfig {
  const kind: ProviderKind =
    item.kind && item.kind in PROVIDER_PRESETS ? item.kind : 'gemini';
  return {
    ...item,
    kind,
    baseUrl: resolveProviderBaseUrl({ kind, baseUrl: item.baseUrl ?? '' }),
    discoveredModels: Array.isArray(item.discoveredModels) ? item.discoveredModels : [],
    persistence,
  };
}

export function loadStoredProviders(): {
  providers: AiProviderConfig[];
  activeProviderId: string | null;
} {
  if (typeof window === 'undefined') {
    return { providers: [], activeProviderId: null };
  }

  const sessionItems =
    safeReadJson<AiProviderConfig[]>(window.sessionStorage, SESSION_STORAGE_KEY) ?? [];
  const localItems =
    safeReadJson<AiProviderConfig[]>(window.localStorage, LOCAL_STORAGE_KEY) ?? [];

  const mergedMap = new Map<string, AiProviderConfig>();
  for (const item of localItems) {
    if (item && typeof item.id === 'string') {
      mergedMap.set(item.id, normalizeLoadedProvider(item, 'local'));
    }
  }
  for (const item of sessionItems) {
    if (item && typeof item.id === 'string') {
      mergedMap.set(item.id, normalizeLoadedProvider(item, 'session'));
    }
  }

  const providers = Array.from(mergedMap.values());
  let activeId =
    window.sessionStorage.getItem(ACTIVE_PROVIDER_KEY) ??
    window.localStorage.getItem(ACTIVE_PROVIDER_KEY);

  if (!activeId || !providers.some((p) => p.id === activeId)) {
    activeId = providers[0]?.id ?? null;
  }

  return { providers, activeProviderId: activeId };
}

export function persistProviders(
  providers: AiProviderConfig[],
  activeProviderId: string | null
): void {
  if (typeof window === 'undefined') return;

  const sessionProviders = providers.filter((p) => p.persistence === 'session');
  const localProviders = providers.filter((p) => p.persistence === 'local');

  try {
    if (sessionProviders.length > 0) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionProviders));
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }

    if (localProviders.length > 0) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localProviders));
    } else {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    if (activeProviderId) {
      window.sessionStorage.setItem(ACTIVE_PROVIDER_KEY, activeProviderId);
      const activeIsLocal = localProviders.some((p) => p.id === activeProviderId);
      if (activeIsLocal) {
        window.localStorage.setItem(ACTIVE_PROVIDER_KEY, activeProviderId);
      } else {
        window.localStorage.removeItem(ACTIVE_PROVIDER_KEY);
      }
    } else {
      window.sessionStorage.removeItem(ACTIVE_PROVIDER_KEY);
      window.localStorage.removeItem(ACTIVE_PROVIDER_KEY);
    }
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function classifyProviderError(
  status: number,
  bodyText: string,
  kind: ProviderKind
): string {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; type?: string; code?: string };
      message?: string;
    };
    detail = parsed?.error?.message ?? parsed?.message ?? '';
  } catch {
    detail = bodyText.slice(0, 180).trim();
  }

  if (status === 401 || status === 403) {
    return detail
      ? `Authentication failed (${status}): ${detail}`
      : `Invalid or unauthorized API key (${status}).`;
  }
  if (status === 404) {
    return detail
      ? `Model or endpoint not found (404): ${detail}`
      : 'Selected model or API endpoint was not found or is unsupported (404).';
  }
  if (status === 429) {
    return detail
      ? `Rate limit or quota exceeded (429): ${detail}`
      : 'Rate limit or quota exceeded (429). Wait and retry.';
  }
  if (status >= 400 && status < 500) {
    if (kind === 'gemini' && /api key not valid/i.test(detail)) {
      return `Invalid Gemini API key: ${detail}`;
    }
    if (/not supported|unsupported|does not exist|invalid model|model.+not found/i.test(detail)) {
      return `Unsupported or unavailable model (${status}): ${detail}`;
    }
    return detail ? `Provider rejected request (${status}): ${detail}` : `Invalid request (${status}).`;
  }
  if (status >= 500) {
    return detail
      ? `Provider service error (${status}): ${detail}`
      : `Provider service temporarily unavailable (${status}).`;
  }
  return detail || `Unexpected HTTP status ${status}.`;
}

function deduplicateStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = item.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

export async function discoverProviderModels(
  provider: Pick<AiProviderConfig, 'kind' | 'baseUrl' | 'apiKey'>,
  fetcher: typeof fetch = fetch,
  externalSignal?: AbortSignal
): Promise<ModelDiscoveryResult> {
  const resolvedBaseUrl = resolveProviderBaseUrl(provider);
  const urlCheck = validateProviderBaseUrl(resolvedBaseUrl);
  if (!urlCheck.valid) {
    return { models: [], error: urlCheck.error };
  }
  const apiKey = provider.apiKey.trim();
  if (!apiKey) {
    return { models: [], error: 'Enter an API key first to load available models.' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const onExternalAbort = () => controller?.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      return { models: [], aborted: true };
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 12000)
    : null;

  try {
    if (provider.kind === 'gemini') {
      const collected: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({ pageSize: '1000' });
        if (pageToken) {
          query.set('pageToken', pageToken);
        }
        const response = await fetcher(`${urlCheck.normalized}/models?${query.toString()}`, {
          method: 'GET',
          headers: {
            'x-goog-api-key': apiKey,
          },
          signal: controller?.signal,
        });

        const rawText = await response.text();
        if (!response.ok) {
          return { models: [], error: classifyProviderError(response.status, rawText, provider.kind) };
        }

        const data = JSON.parse(rawText) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
          nextPageToken?: string;
        };
        const pageModels = (data.models ?? [])
          .filter((m) =>
            Array.isArray(m.supportedGenerationMethods)
              ? m.supportedGenerationMethods.includes('generateContent')
              : true
          )
          .map((m) => (m.name ?? '').replace(/^models\//, ''))
          .filter((id) => Boolean(id));

        collected.push(...pageModels);
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }

      return { models: deduplicateStrings(collected) };
    }

    if (provider.kind === 'anthropic') {
      const collected: string[] = [];
      let afterId: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({ limit: '1000' });
        if (afterId) {
          query.set('after_id', afterId);
        }
        const response = await fetcher(`${urlCheck.normalized}/models?${query.toString()}`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal: controller?.signal,
        });

        const rawText = await response.text();
        if (!response.ok) {
          return { models: [], error: classifyProviderError(response.status, rawText, provider.kind) };
        }

        const data = JSON.parse(rawText) as {
          data?: Array<{ id?: string }>;
          has_more?: boolean;
          last_id?: string;
        };
        const pageModels = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
        collected.push(...pageModels);
        if (!data.has_more || !data.last_id) break;
        afterId = data.last_id;
      }

      return { models: deduplicateStrings(collected) };
    }

    // OpenAI / OpenAI-Compatible — fetch complete list without truncation
    const response = await fetcher(`${urlCheck.normalized}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller?.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      return { models: [], error: classifyProviderError(response.status, rawText, provider.kind) };
    }

    const data = JSON.parse(rawText) as { data?: Array<{ id?: string }> };
    const models = deduplicateStrings((data.data ?? []).map((m) => m.id ?? '').filter(Boolean));
    models.sort((a, b) => a.localeCompare(b));

    return { models };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (externalSignal?.aborted && !timedOut) {
        return { models: [], aborted: true };
      }
      return { models: [], error: 'Model discovery timed out.' };
    }
    return {
      models: [],
      error:
        err instanceof Error
          ? `Network or CORS error during model discovery: ${err.message}`
          : 'Network or CORS error during model discovery.',
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function generateProviderCompletion(
  provider: AiProviderConfig,
  request: ProviderCompletionRequest,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const urlCheck = validateProviderBaseUrl(resolveProviderBaseUrl(provider));
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error ?? 'Invalid provider base URL.');
  }
  if (!provider.apiKey.trim()) {
    throw new Error('API key is missing for the active AI provider.');
  }
  if (!provider.model.trim()) {
    throw new Error('Model name is missing for the active AI provider.');
  }

  const baseUrl = urlCheck.normalized;
  const apiKey = provider.apiKey.trim();
  const model = provider.model.trim();
  const temperature = request.temperature ?? 0.35;
  const maxTokens = request.maxTokens ?? 4096;

  if (provider.kind === 'gemini') {
    const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      contents: request.messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(request.expectJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(classifyProviderError(response.status, rawText, provider.kind));
    }

    const parsed = JSON.parse(rawText) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };
    const text = parsed.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('Provider returned an empty completion.');
    }
    return text;
  }

  if (provider.kind === 'anthropic') {
    const endpoint = `${baseUrl}/messages`;
    const body = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(classifyProviderError(response.status, rawText, provider.kind));
    }

    const parsed = JSON.parse(rawText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = parsed.content
      ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('')
      .trim();

    if (!text) {
      throw new Error('Anthropic returned an empty completion.');
    }
    return text;
  }

  // OpenAI / OpenAI-Compatible
  const endpoint = `${baseUrl}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  if (request.expectJson && provider.kind === 'openai') {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(classifyProviderError(response.status, rawText, provider.kind));
  }

  const parsed = JSON.parse(rawText) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Provider returned an empty completion.');
  }
  return text;
}

export async function testProviderConnection(
  provider: AiProviderConfig,
  fetcher: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  const testedAt = new Date().toISOString();
  const urlCheck = validateProviderBaseUrl(resolveProviderBaseUrl(provider));
  if (!urlCheck.valid) {
    return {
      status: 'error',
      message: urlCheck.error ?? 'Invalid endpoint URL.',
      testedAt,
    };
  }
  if (!provider.apiKey.trim()) {
    return {
      status: 'error',
      message: 'API key is required before testing connection.',
      testedAt,
    };
  }
  if (!provider.model.trim()) {
    return {
      status: 'error',
      message: 'Model identifier is required before testing connection.',
      testedAt,
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;

  try {
    await generateProviderCompletion(
      provider,
      {
        systemPrompt: 'Respond with exactly OK.',
        messages: [{ role: 'user', content: 'OK' }],
        temperature: 0,
        maxTokens: 12,
        expectJson: false,
        signal: controller?.signal,
      },
      fetcher
    );

    const discovered = await discoverProviderModels(provider, fetcher);
    return {
      status: 'connected',
      message: `Connected to ${provider.model.trim()}.`,
      discoveredModels: discovered.models.length > 0 ? discovered.models : undefined,
      testedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 'error',
        message: 'Connection test timed out after 12 seconds.',
        testedAt,
      };
    }
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Network or CORS error connecting to provider.',
      testedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getPersistenceLabel(persistence: CredentialPersistence): string {
  return persistence === 'local' ? 'Remembered locally' : 'Session only';
}
