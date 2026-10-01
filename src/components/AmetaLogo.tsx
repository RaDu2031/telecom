import React from 'react';

interface AmetaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  subtitle?: string;
  theme?: 'light' | 'dark';
}

export const AmetaLogo: React.FC<AmetaLogoProps> = ({
  size = 'md',
  showSubtitle = false,
  subtitle = 'Engenharia & Telecom',
  theme = 'light',
}) => {
  const dimensions =
    size === 'sm'
      ? 'w-7 h-7'
      : size === 'lg'
      ? 'w-10 h-10'
      : 'w-8 h-8';

  const titleSize =
    size === 'sm'
      ? 'text-base'
      : size === 'lg'
      ? 'text-xl'
      : 'text-lg';

  const textColor = theme === 'light' ? 'text-slate-900' : 'text-white';
  const subColor = theme === 'light' ? 'text-slate-500' : 'text-slate-400';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Geometric Ameta Telecom Emblem */}
      <div
        className={`${dimensions} rounded-lg bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 flex items-center justify-center shadow-xs shrink-0 relative overflow-hidden`}
      >
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 text-white"
        >
          {/* Signal Arcs */}
          <path
            d="M9.5 13.5C14.2 8.8 21.8 8.8 26.5 13.5"
            stroke="#93C5FD"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M13 17C15.8 14.2 20.2 14.2 23 17"
            stroke="#DBEAFE"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          {/* Stylized A / Tower Structure */}
          <path
            d="M18 18.5L11.5 30H15L16.4 27H19.6L21 30H24.5L18 18.5Z"
            fill="white"
          />
          {/* Top Signal Core Node */}
          <circle cx="18" cy="18.5" r="2.3" fill="#38BDF8" />
        </svg>
      </div>

      {/* Brand Name */}
      <div className="flex flex-col leading-none">
        <div className={`font-bold tracking-tight ${titleSize} ${textColor} flex items-center gap-1`}>
          <span>Ameta</span>
          <span className="font-medium text-blue-600">Telecom</span>
        </div>
        {showSubtitle && (
          <span className={`text-[11px] font-normal ${subColor} mt-0.5`}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
