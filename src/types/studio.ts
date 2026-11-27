export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

export type FrameRate = 24 | 30 | 60;

export type AiStatus =
  | 'idle'
  | 'planning'
  | 'diagnosing'
  | 'researching'
  | 'thinking'
  | 'reviewing'
  | 'generating'
  | 'compiling'
  | 'repairing';

export type MobilePanelTab = 'viewport' | 'chat' | 'code';

export type CodeLanguage =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'svg'
  | 'xml'
  | 'markdown'
  | 'python'
  | 'plaintext';

export type ProviderKind = 'gemini' | 'openai' | 'anthropic' | 'openai-compatible';

export type CredentialPersistence = 'session' | 'local';

export type ConnectionTestStatus = 'untested' | 'testing' | 'connected' | 'error';

export interface AiProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  persistence: CredentialPersistence;
  discoveredModels: string[];
  lastTestStatus: ConnectionTestStatus;
  lastTestMessage?: string;
  lastTestedAt?: string;
}

export interface SceneFile {
  path: string;
  content: string;
  description?: string;
  updatedAt: string;
}

export interface SceneFileOperation {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  newPath?: string;
  description?: string;
  content?: string;
}

export interface DependencyStatus {
  name: string;
  resolvedUrl: string;
  status: 'ready' | 'failed';
  error?: string;
}

export type RuntimeMode =
  | 'native-html'
  | 'native-esm'
  | 'sucrase-esm'
  | 'esbuild-bundle'
  | 'svg';

export interface RuntimeDiagnostic {
  id: string;
  type: 'compile-error' | 'dependency-error' | 'runtime-error' | 'console-error';
  severity?: 'error' | 'warning';
  message: string;
  source?: string;
  line?: number;
  column?: number;
  timestamp: string;
}

export type RuntimeStatus = 'empty' | 'preparing' | 'compiling' | 'running' | 'error';

export type ActivityStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export type ActivityPhase =
  | 'analyze'
  | 'inspect'
  | 'diagnose'
  | 'research'
  | 'plan'
  | 'self-review'
  | 'dependencies'
  | 'files'
  | 'compile'
  | 'runtime'
  | 'repair'
  | 'complete';

export interface ActivityStep {
  id: string;
  phase: ActivityPhase;
  label: string;
  detail?: string;
  status: ActivityStepStatus;
  timestamp: string;
}

export interface AiCandidateOption {
  approach: string;
  critique: string;
  selected?: boolean;
}

export interface AiWebSource {
  title: string;
  url: string;
}

export interface ActivityRun {
  id: string;
  messageId?: string;
  promptSummary: string;
  status: 'running' | 'success' | 'error';
  providerLabel: string;
  technologies: string[];
  inspectedFiles: string[];
  createdFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  dependencies: DependencyStatus[];
  repairAttempts: number;
  diagnosis?: string;
  alternativesConsidered?: AiCandidateOption[];
  selfReviewNote?: string;
  selectionRationale?: string;
  webSources?: AiWebSource[];
  finalSummary?: string;
  errorDetail?: string;
  steps: ActivityStep[];
  startedAt: string;
  finishedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  activityRunId?: string;
  isError?: boolean;
}

export interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  files: SceneFile[];
  activeFilePath: string | null;
  activityRuns: ActivityRun[];
}

export interface StudioSettings {
  defaultAspectRatio: AspectRatio;
  defaultFrameRate: FrameRate;
  showGuidesByDefault: boolean;
  showLineNumbers: boolean;
}

export interface ScriptFile {
  id: string;
  filename: string;
  description: string;
  content: string;
}
