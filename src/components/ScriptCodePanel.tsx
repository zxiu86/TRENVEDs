import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { Check, Code2, Copy, FileCode2, PanelRightClose } from 'lucide-react';
import type { CodeLanguage, SceneFile } from '../types/studio';
import { detectLanguageFromFilename } from '../utils/studioLogic';

interface ScriptCodePanelProps {
  files: SceneFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
  showLineNumbers: boolean;
  onCollapse?: () => void;
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
      caretColor: 'transparent',
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
  onSelectFile,
  showLineNumbers,
  onCollapse,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const lineNumbersCompartmentRef = useRef(new Compartment());

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

  // Initialize CodeMirror 6 instance once in strictly read-only mode
  useEffect(() => {
    if (!editorHostRef.current) return;

    const state = EditorState.create({
      doc: activeFile?.content ?? '',
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        TRENVEDS_EDITOR_THEME,
        syntaxHighlighting(TRENVEDS_SYNTAX_STYLE),
        lineNumbersCompartmentRef.current.of(showLineNumbers ? lineNumbers() : []),
        languageCompartmentRef.current.of(getLanguageExtension(detectedLanguage.id)),
      ],
    });

    const view = new EditorView({
      state,
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

  // Synchronize document content and dynamically detected language when files update or switch
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const targetContent = activeFile?.content ?? '';
    const currentDoc = view.state.doc.toString();
    view.dispatch({
      changes:
        currentDoc === targetContent
          ? undefined
          : { from: 0, to: currentDoc.length, insert: targetContent },
      effects: languageCompartmentRef.current.reconfigure(
        getLanguageExtension(detectedLanguage.id)
      ),
    });
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
  }, [activeFile?.content, activeFile?.path, detectedLanguage.id]);

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

  return (
    <section
      aria-label="AI Script and Code Viewer"
      className="studio-glass crimson-edge-right flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-all duration-200 ease-out"
    >
      {/* Panel Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 className="h-3.5 w-3.5 shrink-0 text-red-400" />
          <h2 className="font-display text-xs font-semibold tracking-wide text-zinc-100 truncate">
            AI Script
          </h2>
          <span
            data-testid="detected-language-label"
            className="text-[11px] font-mono text-zinc-400 whitespace-nowrap"
          >
            · {activeFile ? detectedLanguage.label : `${files.length} files`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!activeFile}
            className={`studio-glass-control inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all duration-150 whitespace-nowrap disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-red-500 ${
              copyState === 'copied'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : copyState === 'error'
                  ? 'border-red-500/40 bg-red-600/15 text-red-300'
                  : 'text-zinc-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            {copyState === 'copied' ? (
              <>
                <Check className="h-3 w-3" />
                <span>Copied</span>
              </>
            ) : copyState === 'error' ? (
              <span>Unavailable</span>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse AI Script panel"
              aria-label="Collapse AI Script panel"
              className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-zinc-100"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Real Project File Tabs */}
      {files.length > 0 && (
        <div className="studio-scroll flex shrink-0 items-center gap-1 border-b border-white/[0.08] bg-black/25 px-2.5 py-1.5 overflow-x-auto">
          <div role="tablist" aria-label="Project scene files" className="flex items-center gap-1">
            {files.map((file) => {
              const active = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => onSelectFile(file.path)}
                  className={`h-7 rounded-md px-2.5 font-mono text-[11px] transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-500 ${
                    active
                      ? 'border border-red-500/45 bg-red-600/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                      : 'border border-transparent text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                  }`}
                >
                  {file.path}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CodeMirror 6 Viewer or Clean Empty State */}
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
              No scene files generated yet
            </p>
            <p className="mt-1.5 max-w-[230px] text-[11px] leading-relaxed text-zinc-500">
              Ask the AI Director to build a scene. Created HTML, CSS, JS, TypeScript, JSX, or TSX files will appear here live.
            </p>
          </div>
        )}
      </div>

      {/* Footer Note */}
      <div className="shrink-0 border-t border-white/[0.08] bg-black/25 px-3.5 py-2 text-[11px] text-zinc-500 flex items-center justify-between gap-2">
        <span className="truncate">
          {activeFile
            ? activeFile.description || activeFile.path
            : 'Read-only live scene inspector'}
        </span>
        <span className="font-mono tabular-nums shrink-0">
          {activeFile ? `${detectedLanguage.label} · ${lineCount} lines` : '0 files'}
        </span>
      </div>
    </section>
  );
};
