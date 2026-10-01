import React, { useId } from 'react';

interface AmetaLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
  const uid = useId().replace(/:/g, '');

  const iconDimensions =
    size === 'sm'
      ? 'w-11 h-8'
      : size === 'lg'
      ? 'w-16 h-12'
      : size === 'xl'
      ? 'w-20 h-14'
      : 'w-13 h-9';

  const titleSize =
    size === 'sm'
      ? 'text-[19px]'
      : size === 'lg'
      ? 'text-[26px]'
      : size === 'xl'
      ? 'text-[32px]'
      : 'text-[22px]';

  const servicosSize =
    size === 'sm'
      ? 'text-[8.5px] tracking-[0.28em]'
      : size === 'lg'
      ? 'text-[11px] tracking-[0.30em]'
      : size === 'xl'
      ? 'text-[12.5px] tracking-[0.32em]'
      : 'text-[9.5px] tracking-[0.28em]';

  const navyColor = theme === 'light' ? '#223585' : '#FFFFFF';
  const tealColor = theme === 'light' ? '#1E8E8D' : '#38D1D0';
  const subColor = theme === 'light' ? 'text-slate-500' : 'text-slate-300';
  const gapStrokeColor = theme === 'light' ? '#FFFFFF' : '#192766';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Official Ameta Serviços Interlocking Diamonds Emblem */}
      <div className={`${iconDimensions} flex items-center justify-center shrink-0 relative`}>
        <svg
          viewBox="0 0 116 82"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full overflow-visible"
        >
          <defs>
            {/* Clip top half so Navy diamond passes OVER Teal diamond at top intersection */}
            <clipPath id={`ameta-top-over-${uid}`}>
              <rect x="0" y="0" width="116" height="41" />
            </clipPath>
            {/* Clip bottom half so Teal diamond passes OVER Navy diamond at bottom intersection */}
            <clipPath id={`ameta-bottom-over-${uid}`}>
              <rect x="0" y="41" width="116" height="41" />
            </clipPath>
          </defs>

          {/* 1. Base Layer: Left Navy Diamond */}
          <g transform="translate(39, 41) rotate(45)">
            <rect
              x="-21"
              y="-21"
              width="42"
              height="42"
              rx="7"
              stroke={navyColor}
              strokeWidth="9"
              fill="none"
            />
          </g>

          {/* 2. Base Layer: Right Teal Diamond */}
          <g transform="translate(77, 41) rotate(45)">
            <rect
              x="-21"
              y="-21"
              width="42"
              height="42"
              rx="7"
              stroke={tealColor}
              strokeWidth="9"
              fill="none"
            />
          </g>

          {/* 3. Top Crossing: Navy passes OVER Teal with clean gap */}
          <g clipPath={`url(#ameta-top-over-${uid})`}>
            <g transform="translate(39, 41) rotate(45)">
              <rect
                x="-21"
                y="-21"
                width="42"
                height="42"
                rx="7"
                stroke={gapStrokeColor}
                strokeWidth="14"
                fill="none"
              />
              <rect
                x="-21"
                y="-21"
                width="42"
                height="42"
                rx="7"
                stroke={navyColor}
                strokeWidth="9"
                fill="none"
              />
            </g>
          </g>

          {/* 4. Bottom Crossing: Teal passes OVER Navy with clean gap */}
          <g clipPath={`url(#ameta-bottom-over-${uid})`}>
            <g transform="translate(77, 41) rotate(45)">
              <rect
                x="-21"
                y="-21"
                width="42"
                height="42"
                rx="7"
                stroke={gapStrokeColor}
                strokeWidth="14"
                fill="none"
              />
              <rect
                x="-21"
                y="-21"
                width="42"
                height="42"
                rx="7"
                stroke={tealColor}
                strokeWidth="9"
                fill="none"
              />
            </g>
          </g>
        </svg>
      </div>

      {/* Brand Typography: "Ameta" + "SERVIÇOS" */}
      <div className="flex flex-col leading-none">
        <span
          className={`font-extrabold tracking-tight ${titleSize} leading-[0.95]`}
          style={{ color: navyColor }}
        >
          Ameta
        </span>
        <span
          className={`font-bold uppercase ${servicosSize} mt-1 leading-none`}
          style={{ color: tealColor }}
        >
          SERVIÇOS
        </span>
        {showSubtitle && subtitle && (
          <span className={`text-[10px] font-medium ${subColor} mt-1 tracking-normal`}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
