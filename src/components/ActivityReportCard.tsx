import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  FileCode2,
  Globe,
  Loader2,
  Microscope,
  Package,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type { ActivityRun, ActivityStep } from '../types/studio';

interface ActivityReportCardProps {
  run: ActivityRun;
  onSelectFile?: (path: string) => void;
}

const StepIcon: React.FC<{ status: ActivityStep['status'] }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />;
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    case 'error':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
    case 'skipped':
    case 'pending':
    default:
      return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-zinc-500" />;
  }
};

export const ActivityReportCard: React.FC<ActivityReportCardProps> = ({
  run,
  onSelectFile,
}) => {
  const [isExpanded, setIsExpanded] = useState(
    run.status === 'running' || run.status === 'error'
  );

  const totalFilesTouched =
    run.createdFiles.length + run.modifiedFiles.length + run.deletedFiles.length;

  const statusTone =
    run.status === 'running'
      ? 'border-amber-500/35 bg-amber-500/[0.06]'
      : run.status === 'error'
        ? 'border-red-500/45 bg-red-600/[0.08]'
        : 'border-white/10 bg-white/[0.03]';

  return (
    <div
      data-testid={`activity-report-${run.id}`}
      data-status={run.status}
      className={`rounded-xl border text-xs transition-all duration-150 ${statusTone}`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          {run.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />
          ) : run.status === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          )}
          <span className="truncate font-medium text-zinc-200">
            {run.status === 'running'
              ? 'Studio Work Report · Running'
              : run.status === 'error'
                ? 'Studio Work Report · Issues detected'
                : 'Studio Work Report'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-[11px] font-mono text-zinc-400">
          {totalFilesTouched > 0 && <span>{totalFilesTouched} files</span>}
          {run.repairAttempts > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Wrench className="h-3 w-3" />
              <span>
                {run.repairAttempts} {run.repairAttempts === 1 ? 'repair' : 'repairs'}
              </span>
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-white/[0.08] px-3 py-2.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-zinc-400">
            <span className="font-mono truncate">{run.providerLabel}</span>
            {run.technologies.length > 0 && (
              <span className="text-zinc-300">{run.technologies.join(' · ')}</span>
            )}
          </div>

          <ul className="space-y-1.5">
            {run.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5">
                  <StepIcon status={step.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-200 leading-snug">{step.label}</p>
                  {step.detail && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400 break-words">
                      {step.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {run.diagnosis && (
            <div
              data-testid="activity-diagnosis"
              className="border-t border-white/[0.06] pt-2 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <Microscope className="h-3 w-3 text-red-400" />
                <span>Diagnosis</span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-300 break-words">
                {run.diagnosis}
              </p>
            </div>
          )}

          {((run.alternativesConsidered && run.alternativesConsidered.length > 0) ||
            run.selfReviewNote ||
            run.selectionRationale) && (
            <div
              data-testid="activity-self-review"
              className="border-t border-white/[0.06] pt-2 space-y-1.5"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                <span>Options &amp; Self-Review</span>
              </div>
              {run.alternativesConsidered && run.alternativesConsidered.length > 0 && (
                <ul className="space-y-1">
                  {run.alternativesConsidered.map((opt, idx) => (
                    <li
                      key={`${opt.approach}-${idx}`}
                      className={`rounded-md border px-2 py-1.5 text-[10px] leading-relaxed ${
                        opt.selected
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-zinc-100'
                          : 'border-white/[0.06] bg-black/25 text-zinc-400'
                      }`}
                    >
                      <span className="font-medium text-zinc-200">
                        {opt.selected ? 'Selected: ' : 'Evaluated: '}
                        {opt.approach}
                      </span>
                      <p className="mt-0.5 text-[10px] text-zinc-400 break-words">
                        {opt.critique}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {run.selectionRationale && (
                <p className="text-[10px] leading-relaxed text-zinc-300 break-words">
                  {run.selectionRationale}
                </p>
              )}
              {run.selfReviewNote && (
                <p className="text-[10px] leading-relaxed text-zinc-400 break-words">
                  Verification: {run.selfReviewNote}
                </p>
              )}
            </div>
          )}

          {run.webSources && run.webSources.length > 0 && (
            <div
              data-testid="activity-web-sources"
              className="border-t border-white/[0.06] pt-2 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <Globe className="h-3 w-3 text-sky-400" />
                <span>Verified Web Sources</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {run.webSources.map((src) => (
                  <a
                    key={src.url}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/20"
                  >
                    <span className="truncate max-w-[200px]">{src.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {(run.createdFiles.length > 0 ||
            run.modifiedFiles.length > 0 ||
            run.deletedFiles.length > 0) && (
            <div className="border-t border-white/[0.06] pt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <FileCode2 className="h-3 w-3" />
                <span>Files Touched</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {run.createdFiles.map((path) => (
                  <button
                    key={`created-${path}`}
                    type="button"
                    onClick={() => onSelectFile?.(path)}
                    className="rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                  >
                    + {path}
                  </button>
                ))}
                {run.modifiedFiles.map((path) => (
                  <button
                    key={`modified-${path}`}
                    type="button"
                    onClick={() => onSelectFile?.(path)}
                    className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200 hover:bg-amber-500/20"
                  >
                    ~ {path}
                  </button>
                ))}
                {run.deletedFiles.map((path) => (
                  <span
                    key={`deleted-${path}`}
                    className="rounded border border-red-500/35 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-300 line-through"
                  >
                    - {path}
                  </span>
                ))}
              </div>
            </div>
          )}

          {run.dependencies.length > 0 && (
            <div className="border-t border-white/[0.06] pt-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <Package className="h-3 w-3" />
                <span>Dependencies</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {run.dependencies.map((dep) => (
                  <span
                    key={dep.name}
                    title={dep.error || dep.resolvedUrl}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                      dep.status === 'ready'
                        ? 'border-white/10 bg-white/[0.04] text-zinc-300'
                        : 'border-red-500/40 bg-red-500/15 text-red-300'
                    }`}
                  >
                    {dep.name} ({dep.status})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
