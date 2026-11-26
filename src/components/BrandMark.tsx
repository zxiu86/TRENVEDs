import React from 'react';

interface BrandMarkProps {
  compact?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ compact = false }) => {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        width={compact ? 22 : 26}
        height={compact ? 22 : 26}
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="1.5"
          y="3.5"
          width="25"
          height="21"
          rx="3"
          fill="#0E0F14"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1.25"
        />
        <path
          d="M1.5 6.5V21.5"
          stroke="#DC2626"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M11 10.25L18.5 14L11 17.75V10.25Z"
          fill="#F4F4F5"
        />
      </svg>
      <span
        className={`font-display font-bold tracking-tight text-zinc-100 ${
          compact ? 'text-base' : 'text-lg'
        }`}
      >
        TRENVED<span className="text-red-500">s</span>
      </span>
    </span>
  );
};
