import React, { useEffect, useMemo, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  PanelRightClose,
  Pencil,
  Play,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CodeLanguage, SceneFile } from '../types/studio';
import {
  FILE_INPUT_ACCEPT,
  inferFilenameFromCode,
  normalizeScenePath,
  resolveImportConflictName,
  validateImportedFile,
} from '../utils/sceneFiles';
import { detectLanguageFromFilename } from '../utils/studioLogic';

interface ScriptCodePanelProps {
  files: SceneFile[];
  activeFilePath: string | null;
  entryFilePath: string | null;
  hasPendingRunChanges: boolean;
  isRunningScene: boolean;
  showLineNumbers: boolean;
  onSelectFile: (path: string) => void;
  onUpdateFileContent: (path: string, content: string) => void;
  onUpsertFiles: (
    incoming: Array<{ path: string; content: string; description?: string }>,
    nextActivePath?: string | null
  ) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFile: (path: string) => void;
  onRunScene: () => void;
  onCollapse?: () => void;
}

interface PendingImportConflict {
  id: string;
  targetPath: string;
  suggestedRenamePath: string;
  content: string;
  description: string;
}

function getLanguageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case 'html':
      return html();
    case 'css':
      return css();
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'json':
      return json();
    case 'svg':
    case 'xml':
      return xml();
    case 'markdown':
      return markdown();
    case 'python':
      return python();
    case 'plaintext':
    default:
      return [];
  }
}

const TRENVEDS_SYNTAX_STYLE = HighlightStyle.define([
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword], color: '#f87171' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#fbbf24' },
  { tag: [tags.string, tags.special(tags.string)], color: '#6ee7b7' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: '#7dd3fc' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#e2e8f0', fontWeight: '500' },
  { tag: [tags.propertyName, tags.attributeName], color: '#cbd5e1' },
  { tag: [tags.tagName, tags.angleBracket], color: '#fb7185' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: '#f4f4f5' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#94a3b8' },
  { tag: [tags.meta, tags.processingInstruction], color: '#fca5a5' },
  { tag: tags.heading, color: '#f8fafc', fontWeight: '600' },
]);

const TRENVEDS_EDITOR_THEME = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'rgba(6, 7, 11, 0.56)',
      color: '#e4e4e7',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: '1.65',
      paddingTop: '10px',
      paddingBottom: '12px',
    },
    '.cm-content': {
      paddingRight: '16px',
      caretColor: '#f87171',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#f87171',
      borderLeftWidth: '1.5px',
    },
    '.cm-line': {
      paddingLeft: '10px',
      paddingRight: '12px',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(8, 9, 14, 0.45)',
      color: '#52525b',
      borderRight: '1px solid rgba(255, 255, 255, 0.06)',
      paddingLeft: '4px',
      paddingRight: '6px',
      userSelect: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '28px',
      fontSize: '11px',
      fontVariantNumeric: 'tabular-nums',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      color: '#a1a1aa',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(220, 38, 38, 0.25) !important',
    },
  },
  { dark: true }
);

export const ScriptCodePanel: React.FC<ScriptCodePanelProps> = ({
  files,
  activeFilePath,
  entryFilePath,
  hasPendingRunChanges,
  isRunningScene,
  showLineNumbers,
  onSelectFile,
  onUpdateFileContent,
  onUpsertFiles,
  onRenameFile,
  onDeleteFile,
  onRunScene,
  onCollapse,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<PendingImportConflict[]>([]);

  // Inline New / Paste File composer state
  const [isNewComposerOpen, setIsNewComposerOpen] = useState(false);
  const [newFilenameInput, setNewFilenameInput] = useState('');
  const [newCodeInput, setNewCodeInput] = useState('');

  // Inline Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const lineNumbersCompartmentRef = useRef(new Compartment());

  // Preserve per-file EditorState (undo history, cursor, selection) & scroll offsets across file switches/collapses
  const editorStatesRef = useRef<Map<string, EditorState>>(new Map());
  const scrollCacheRef = useRef<Map<string, { top: number; left: number }>>(new Map());
  const loadedPathRef = useRef<string | null>(null);
  const isSyncingFromPropRef = useRef(false);
  const lastEmittedRef = useRef<{ path: string; content: string } | null>(null);
  const onUpdateFileContentRef = useRef(onUpdateFileContent);
  onUpdateFileContentRef.current = onUpdateFileContent;

  const activeFile = useMemo(() => {
    if (files.length === 0) return null;
    if (activeFilePath) {
      const match = files.find((file) => file.path === activeFilePath);
      if (match) return match;
    }
    return files[0];
  }, [files, activeFilePath]);

  const detectedLanguage = useMemo(
    () =>
      activeFile
        ? detectLanguageFromFilename(activeFile.path)
        : { id: 'plaintext' as CodeLanguage, label: 'Empty' },
    [activeFile]
  );

  const lineCount = useMemo(
    () => (activeFile ? activeFile.content.split('\n').length : 0),
    [activeFile]
  );

  const suggestedNewFilename = useMemo(() => {
    const manual = normalizeScenePath(newFilenameInput);
    if (manual) return manual;
    return inferFilenameFromCode(newCodeInput, files);
  }, [newFilenameInput, newCodeInput, files]);

  const buildEditorState = (content: string, language: CodeLanguage, showNums: boolean): EditorState => {
    return EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorState.readOnly.of(false),
        EditorView.editable.of(true),
        EditorView.lineWrapping,
        TRENVEDS_EDITOR_THEME,
        syntaxHighlighting(TRENVEDS_SYNTAX_STYLE),
        lineNumbersCompartmentRef.current.of(showNums ? lineNumbers() : []),
        languageCompartmentRef.current.of(getLanguageExtension(language)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isSyncingFromPropRef.current) return;
          const currentPath = loadedPathRef.current;
          if (!currentPath) return;
          const nextText = update.state.doc.toString();
          editorStatesRef.current.set(currentPath, update.state);
          lastEmittedRef.current = { path: currentPath, content: nextText };
          onUpdateFileContentRef.current(currentPath, nextText);
        }),
      ],
    });
  };

  // Initialize CodeMirror 6 instance once in full editable mode
  useEffect(() => {
    if (!editorHostRef.current) return;

    const initialState = buildEditorState(
      activeFile?.content ?? '',
      detectedLanguage.id,
      showLineNumbers
    );
    if (activeFile?.path) {
      editorStatesRef.current.set(activeFile.path, initialState);
      loadedPathRef.current = activeFile.path;
    }

    const view = new EditorView({
      state: initialState,
      parent: editorHostRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // Mounted once; updates synchronize below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prune editor cache when files are deleted/renamed
  useEffect(() => {
    const existingSet = new Set(files.map((f) => f.path));
    for (const cachedPath of editorStatesRef.current.keys()) {
      if (!existingSet.has(cachedPath)) {
        editorStatesRef.current.delete(cachedPath);
        scrollCacheRef.current.delete(cachedPath);
      }
    }
  }, [files]);

  // Synchronize EditorView cleanly on file switch or external AI/import update without breaking local cursor/undo
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const prevPath = loadedPathRef.current;
    const nextPath = activeFile?.path ?? null;

    if (prevPath !== nextPath) {
      if (prevPath) {
        editorStatesRef.current.set(prevPath, view.state);
        scrollCacheRef.current.set(prevPath, {
          top: view.scrollDOM.scrollTop,
          left: view.scrollDOM.scrollLeft,
        });
      }

      loadedPathRef.current = nextPath;

      if (!activeFile) {
        isSyncingFromPropRef.current = true;
        view.setState(buildEditorState('', 'plaintext', showLineNumbers));
        isSyncingFromPropRef.current = false;
        return;
      }

      let targetState = editorStatesRef.current.get(activeFile.path);
      if (!targetState) {
        targetState = buildEditorState(activeFile.content, detectedLanguage.id, showLineNumbers);
        editorStatesRef.current.set(activeFile.path, targetState);
      }

      isSyncingFromPropRef.current = true;
      view.setState(targetState);
      if (view.state.doc.toString() !== activeFile.content) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: activeFile.content },
        });
      }
      view.dispatch({
        effects: [
          languageCompartmentRef.current.reconfigure(getLanguageExtension(detectedLanguage.id)),
          lineNumbersCompartmentRef.current.reconfigure(showLineNumbers ? lineNumbers() : []),
        ],
      });
      isSyncingFromPropRef.current = false;

      const savedScroll = scrollCacheRef.current.get(activeFile.path);
      view.scrollDOM.scrollTop = savedScroll?.top ?? 0;
      view.scrollDOM.scrollLeft = savedScroll?.left ?? 0;
      return;
    }

    if (!activeFile) return;

    // Same file active: skip if this update came from user typing in CodeMirror itself
    if (
      lastEmittedRef.current &&
      lastEmittedRef.current.path === activeFile.path &&
      lastEmittedRef.current.content === activeFile.content
    ) {
      return;
    }

    const currentDoc = view.state.doc.toString();
    isSyncingFromPropRef.current = true;
    view.dispatch({
      changes:
        currentDoc === activeFile.content
          ? undefined
          : { from: 0, to: currentDoc.length, insert: activeFile.content },
      effects: languageCompartmentRef.current.reconfigure(
        getLanguageExtension(detectedLanguage.id)
      ),
    });
    editorStatesRef.current.set(activeFile.path, view.state);
    isSyncingFromPropRef.current = false;
  }, [activeFile?.path, activeFile?.content, detectedLanguage.id, showLineNumbers]);

  // Synchronize line number preference dynamically
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumbersCompartmentRef.current.reconfigure(
        showLineNumbers ? lineNumbers() : []
      ),
    });
  }, [showLineNumbers]);

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(activeFile.content);
      } else {
        const helper = document.createElement('textarea');
        helper.value = activeFile.content;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(helper);
        if (!ok) throw new Error('Copy command rejected');
      }
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  };

  const handleImportFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) return;

    const cleanImports: Array<{ path: string; content: string; description?: string }> = [];
    const nextConflicts: PendingImportConflict[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const existingSet = new Set(files.map((f) => f.path.toLowerCase()));

    for (const file of selected) {
      try {
        const text = await file.text();
        const validation = validateImportedFile(file.name, text, file.size);
        if (!validation.valid) {
          errors.push(validation.error ?? `Rejected "${file.name}".`);
          continue;
        }
        if (validation.warning) {
          warnings.push(validation.warning);
        }

        if (existingSet.has(validation.normalizedPath.toLowerCase())) {
          const virtualPool = [
            ...files,
            ...cleanImports.map((c) => ({ path: c.path, content: c.content, updatedAt: '' })),
          ];
          nextConflicts.push({
            id: `conf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            targetPath: validation.normalizedPath,
            suggestedRenamePath: resolveImportConflictName(virtualPool, validation.normalizedPath),
            content: text,
            description: `Imported ${validation.normalizedPath}`,
          });
        } else {
          existingSet.add(validation.normalizedPath.toLowerCase());
          cleanImports.push({
            path: validation.normalizedPath,
            content: text,
            description: `Imported ${validation.normalizedPath}`,
          });
        }
      } catch {
        errors.push(`Failed to read "${file.name}".`);
      }
    }

    if (cleanImports.length > 0) {
      onUpsertFiles(cleanImports, cleanImports[0].path);
    }

    if (nextConflicts.length > 0) {
      setConflicts((prev) => [...prev, ...nextConflicts]);
    }

    if (errors.length > 0) {
      setNotice({ tone: 'error', message: errors.join(' ') });
    } else if (warnings.length > 0) {
      setNotice({ tone: 'warning', message: warnings.join(' ') });
    } else if (cleanImports.length > 0) {
      setNotice({
        tone: 'info',
        message: `Imported ${cleanImports.length} ${cleanImports.length === 1 ? 'file' : 'files'}. Click Run to execute in Viewport.`,
      });
    }
  };

  const resolveConflict = (
    conflictId: string,
    mode: 'replace' | 'keep-both' | 'skip'
  ) => {
    const target = conflicts.find((c) => c.id === conflictId);
    if (!target) return;

    if (mode === 'replace') {
      onUpsertFiles(
        [{ path: target.targetPath, content: target.content, description: target.description }],
        target.targetPath
      );
      setNotice({ tone: 'info', message: `Replaced "${target.targetPath}". Click Run to update preview.` });
    } else if (mode === 'keep-both') {
      const safeName = resolveImportConflictName(files, target.targetPath);
      onUpsertFiles(
        [{ path: safeName, content: target.content, description: `Imported as ${safeName}` }],
        safeName
      );
      setNotice({ tone: 'info', message: `Kept both files (saved as "${safeName}").` });
    }

    setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
  };

  const handlePasteFromClipboardToComposer = async () => {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        setNotice({
          tone: 'warning',
          message: 'Clipboard read is restricted here. Paste directly with Ctrl+V / Cmd+V inside the code box.',
        });
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        setNotice({ tone: 'info', message: 'Clipboard is empty.' });
        return;
      }
      setNewCodeInput(text);
    } catch {
      setNotice({
        tone: 'warning',
        message: 'Clipboard permission declined. Paste directly with Ctrl+V / Cmd+V.',
      });
    }
  };

  const handleCreateNewFile = (event: React.FormEvent) => {
    event.preventDefault();
    const targetPath = suggestedNewFilename;
    const validation = validateImportedFile(targetPath, newCodeInput, newCodeInput.length);
    if (!validation.valid) {
      setNotice({ tone: 'error', message: validation.error ?? 'Invalid file or code content.' });
      return;
    }

    const exists = files.some(
      (f) => f.path.toLowerCase() === validation.normalizedPath.toLowerCase()
    );
    if (exists) {
      setConflicts((prev) => [
        ...prev,
        {
          id: `conf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          targetPath: validation.normalizedPath,
          suggestedRenamePath: resolveImportConflictName(files, validation.normalizedPath),
          content: newCodeInput,
          description: `Pasted ${validation.normalizedPath}`,
        },
      ]);
      setIsNewComposerOpen(false);
      setNewFilenameInput('');
      setNewCodeInput('');
      return;
    }

    onUpsertFiles(
      [
        {
          path: validation.normalizedPath,
          content: newCodeInput,
          description: newCodeInput.trim() ? 'Created from pasted code' : 'Custom scene file',
        },
      ],
      validation.normalizedPath
    );
    if (validation.warning) {
      setNotice({ tone: 'warning', message: validation.warning });
    } else {
      setNotice(null);
    }
    setIsNewComposerOpen(false);
    setNewFilenameInput('');
    setNewCodeInput('');
    window.requestAnimationFrame(() => {
      editorViewRef.current?.focus();
    });
  };

  const startRenameActive = () => {
    if (!activeFile) return;
    setRenamingPath(activeFile.path);
    setRenameDraft(activeFile.path);
  };

  const commitRename = () => {
    if (!renamingPath) return;
    const normalizedNext = normalizeScenePath(renameDraft);
    if (!normalizedNext || normalizedNext === renamingPath) {
      setRenamingPath(null);
      return;
    }
    const validation = validateImportedFile(normalizedNext, activeFile?.content ?? '');
    if (!validation.valid) {
      setNotice({ tone: 'error', message: validation.error ?? 'Unsupported file extension.' });
      return;
    }
    const duplicate = files.some(
      (f) => f.path !== renamingPath && f.path.toLowerCase() === validation.normalizedPath.toLowerCase()
    );
    if (duplicate) {
      setNotice({
        tone: 'error',
        message: `Cannot rename to "${validation.normalizedPath}" because a file with that name already exists.`,
      });
      return;
    }
    onRenameFile(renamingPath, validation.normalizedPath);
    setRenamingPath(null);
    setNotice(null);
  };

  return (
    <section
      aria-label="AI Script Code Editor"
      className="studio-glass crimson-edge-right flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-all duration-200 ease-out"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        onChange={handleImportFilesSelected}
        data-testid="script-file-import-input"
        className="hidden"
      />

      {/* Panel Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-3">
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <Code2 className="h-3.5 w-3.5 shrink-0 text-red-400" />
          <h2 className="font-display text-xs font-semibold tracking-wide text-zinc-100 whitespace-nowrap">
            AI Script
          </h2>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {files.length > 0 && (
            <button
              type="button"
              onClick={onRunScene}
              disabled={isRunningScene}
              data-testid="script-run-button"
              aria-label="Run scene in viewport"
              title={
                hasPendingRunChanges
                  ? 'Run modified code in Scene Viewport'
                  : 'Run scene in Scene Viewport'
              }
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-all duration-150 whitespace-nowrap disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-red-500 ${
                hasPendingRunChanges
                  ? 'border border-red-500/60 bg-red-600/25 text-white shadow-[0_0_16px_-4px_rgba(220,38,38,0.55)] hover:bg-red-600/40'
                  : 'studio-glass-control text-zinc-200 hover:border-red-500/40 hover:text-white'
              }`}
            >
              <Play className="h-3 w-3 text-red-400" />
              <span>Run</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            data-testid="script-import-button"
            aria-label="Import code files"
            title="Import files from computer"
            className="studio-glass-control inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-zinc-200 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white whitespace-nowrap"
          >
            <Upload className="h-3 w-3 shrink-0" />
            <span className="hidden 2xl:inline">Import</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewComposerOpen((prev) => !prev)}
            data-testid="script-new-file-button"
            aria-label="New or paste file"
            aria-expanded={isNewComposerOpen}
            title="Create a new file or paste code"
            className={`studio-glass-control inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              isNewComposerOpen
                ? 'border-red-500/50 bg-red-600/20 text-white'
                : 'text-zinc-200 hover:border-white/25 hover:bg-white/10 hover:text-white'
            }`}
          >
            <FilePlus2 className="h-3 w-3 shrink-0" />
            <span className="hidden 2xl:inline">New</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!activeFile}
            aria-label="Copy active file code"
            title="Copy code"
            className={`studio-glass-control inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-medium transition-all duration-150 whitespace-nowrap disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-red-500 ${
              copyState === 'copied'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : copyState === 'error'
                  ? 'border-red-500/40 bg-red-600/15 text-red-300'
                  : 'text-zinc-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            {copyState === 'copied' ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Hide Script panel"
              aria-label="Hide Script panel"
              className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-zinc-100"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Inline New File / Paste Code Composer */}
      {isNewComposerOpen && (
        <form
          onSubmit={handleCreateNewFile}
          data-testid="new-file-composer"
          className="shrink-0 border-b border-white/[0.08] bg-[#08090F]/90 px-3 py-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-200">
              New File or Paste Code
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePasteFromClipboardToComposer}
                className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[10px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                <ClipboardPaste className="h-3 w-3" />
                <span>Paste Clipboard</span>
              </button>
              <button
                type="button"
                onClick={() => setIsNewComposerOpen(false)}
                aria-label="Close new file composer"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="new-script-filename" className="sr-only">
              Filename
            </label>
            <input
              id="new-script-filename"
              type="text"
              value={newFilenameInput}
              onChange={(e) => setNewFilenameInput(e.target.value)}
              placeholder={`Auto: ${suggestedNewFilename}`}
              className="h-8 flex-1 rounded-md border border-white/10 bg-black/50 px-2.5 font-mono text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
            />
            <span className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
              {detectLanguageFromFilename(suggestedNewFilename).label}
            </span>
          </div>

          <label htmlFor="new-script-paste-area" className="sr-only">
            Paste code
          </label>
          <textarea
            id="new-script-paste-area"
            rows={4}
            value={newCodeInput}
            onChange={(e) => setNewCodeInput(e.target.value)}
            placeholder="Paste HTML, CSS, JS, TypeScript, JSX, TSX, SVG, or JSON here — or leave blank to write directly in the editor..."
            className="studio-scroll w-full resize-y rounded-md border border-white/10 bg-black/50 p-2 font-mono text-[11px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/60 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500 truncate">
              Target: <span className="font-mono text-zinc-300">{suggestedNewFilename}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsNewComposerOpen(false)}
                className="h-7 rounded-md border border-white/10 px-2.5 text-[11px] text-zinc-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="create-file-submit"
                className="h-7 rounded-md bg-red-600 px-3 text-[11px] font-medium text-white hover:bg-red-500"
              >
                Add File
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Import Conflict Resolution Banner */}
      {conflicts.length > 0 && (
        <div
          data-testid="import-conflict-banner"
          className="shrink-0 border-b border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 space-y-2"
        >
          {conflicts.map((conflict) => (
            <div
              key={conflict.id}
              className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
            >
              <span className="text-amber-100 min-w-0 truncate">
                <span className="font-mono font-medium">{conflict.targetPath}</span> already exists
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => resolveConflict(conflict.id, 'replace')}
                  className="rounded border border-red-500/45 bg-red-600/20 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-600/35"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict(conflict.id, 'keep-both')}
                  className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/25"
                >
                  Keep Both
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict(conflict.id, 'skip')}
                  className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10"
                >
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Validation / Status Banner */}
      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="script-notice-banner"
          className={`flex shrink-0 items-start justify-between gap-2 border-b px-3 py-1.5 text-[11px] ${
            notice.tone === 'error'
              ? 'border-red-500/40 bg-red-600/15 text-red-200'
              : notice.tone === 'warning'
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                : 'border-white/10 bg-white/[0.04] text-zinc-300'
          }`}
        >
          <div className="flex items-start gap-1.5 min-w-0">
            {notice.tone !== 'info' && (
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            )}
            <span className="break-words">{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss script notice"
            className="shrink-0 text-zinc-400 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Real Project File Tabs + Active Rename / Delete */}
      {files.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-white/[0.08] bg-black/25 px-2.5 py-1.5">
          <div className="studio-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <div role="tablist" aria-label="Project scene files" className="flex items-center gap-1">
              {files.map((file) => {
                const active = activeFile?.path === file.path;
                const isEntry = entryFilePath === file.path;

                if (renamingPath === file.path) {
                  return (
                    <form
                      key={file.path}
                      onSubmit={(e) => {
                        e.preventDefault();
                        commitRename();
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenamingPath(null);
                        }}
                        aria-label={`Rename ${file.path}`}
                        className="h-7 w-32 rounded-md border border-red-500/60 bg-black/70 px-2 font-mono text-[11px] text-white focus:outline-none"
                      />
                      <button
                        type="submit"
                        aria-label="Confirm rename"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </form>
                  );
                }

                return (
                  <button
                    key={file.path}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    onClick={() => onSelectFile(file.path)}
                    title={isEntry ? `${file.path} (Entry file)` : file.path}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-500 ${
                      active
                        ? 'border border-red-500/45 bg-red-600/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                        : 'border border-transparent text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                    }`}
                  >
                    {isEntry && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                      />
                    )}
                    <span>{file.path}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeFile && !renamingPath && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={startRenameActive}
                aria-label={`Rename ${activeFile.path}`}
                title="Rename active file"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteFile(activeFile.path)}
                aria-label={`Delete ${activeFile.path}`}
                title="Delete active file"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-600/15 hover:text-red-300"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* CodeMirror 6 Live Editor or Empty Workspace Callout */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <div
          ref={editorHostRef}
          data-testid="code-viewer-body"
          data-language={detectedLanguage.id}
          data-filename={activeFile?.path ?? ''}
          className={`h-full w-full ${files.length === 0 ? 'invisible pointer-events-none' : ''}`}
        />

        {files.length === 0 && (
          <div
            data-testid="script-empty-state"
            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-400">
              <FileCode2 className="h-5 w-5 text-red-400" />
            </div>
            <p className="mt-3 font-display text-xs font-semibold text-zinc-200">
              No scene files yet
            </p>
            <p className="mt-1.5 max-w-[240px] text-[11px] leading-relaxed text-zinc-500">
              Ask AI Direction to build a scene, or import existing code files and paste code directly here.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="studio-glass-control inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium text-zinc-200 hover:border-red-500/40 hover:text-white"
              >
                <Upload className="h-3.5 w-3.5 text-red-400" />
                <span>Import Files</span>
              </button>
              <button
                type="button"
                onClick={() => setIsNewComposerOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/45 bg-red-600/20 px-3 text-[11px] font-medium text-white hover:bg-red-600/35"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>Paste / New File</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="shrink-0 border-t border-white/[0.08] bg-black/25 px-3.5 py-2 text-[11px] text-zinc-500 flex items-center justify-between gap-2">
        <span className="truncate">
          {activeFile
            ? hasPendingRunChanges
              ? 'Edited — click Run to update Viewport'
              : activeFile.description || activeFile.path
            : 'Editable scene code workspace'}
        </span>
        <span
          data-testid="detected-language-label"
          className="font-mono tabular-nums shrink-0"
        >
          {activeFile ? `${detectedLanguage.label} · ${lineCount} lines` : '0 files'}
        </span>
      </div>
    </section>
  );
};
