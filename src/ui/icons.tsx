// ============================================================================
// Line icons (1.6px stroke, 20px grid). Replaces emoji throughout the UI.
// ============================================================================
import type React from 'react';

export type IconName =
  | 'map'
  | 'fleet'
  | 'buy'
  | 'schedule'
  | 'airport'
  | 'save'
  | 'menu'
  | 'layers'
  | 'close'
  | 'play'
  | 'pause'
  | 'plus'
  | 'minus'
  | 'search'
  | 'chevron'
  | 'warning'
  | 'check'
  | 'download'
  | 'upload'
  | 'trash'
  | 'edit'
  | 'swap'
  | 'bank'
  | 'flag'
  | 'letter'
  | 'chart';

const PATHS: Record<IconName, React.ReactNode> = {
  map: <path d="M3 5.5 7.5 4l5 1.5L17 4v10.5L12.5 16l-5-1.5L3 16V5.5ZM7.5 4v10.5M12.5 5.5V16" />,
  // a plane seen from above
  fleet: <path d="M10 2.5c.7 0 1.1.8 1.1 1.8v3.4l5.4 3.1v1.6l-5.4-1.6v3.3l1.7 1.3v1.3L10 16.1l-2.8.6v-1.3l1.7-1.3v-3.3L3.5 12.4v-1.6l5.4-3.1V4.3c0-1 .4-1.8 1.1-1.8Z" />,
  buy: <path d="M4 6h12l-1.2 8.5a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3L4 6Zm3 0V5a3 3 0 0 1 6 0v1" />,
  schedule: <path d="M4 5.5h12v10.5H4V5.5Zm0 3.5h12M7.5 3.5v3M12.5 3.5v3M7 12h2.5M11 12h2" />,
  airport: <path d="M3 16.5h14M5 16.5V9h10v7.5M10 9V4.5M8 4.5h4M7.5 12h1.5M11 12h1.5" />,
  save: <path d="M4.5 3.5h9l2.5 2.5v10.5h-11.5v-13Zm2.5 0v4h6v-4M7 16.5v-5h6v5" />,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  layers: <path d="m10 3.5 7 3.5-7 3.5L3 7l7-3.5Zm-7 7 7 3.5 7-3.5M3 13.5 10 17l7-3.5" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  play: <path d="M7 4.5v11l8.5-5.5L7 4.5Z" />,
  pause: <path d="M6.5 4.5v11M13.5 4.5v11" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  minus: <path d="M4.5 10h11" />,
  search: <path d="M8.75 14.5a5.75 5.75 0 1 0 0-11.5 5.75 5.75 0 0 0 0 11.5ZM13 13l4 4" />,
  chevron: <path d="m8 5 5 5-5 5" />,
  warning: <path d="M10 3.5 17.5 16.5h-15L10 3.5ZM10 8.5v3.5M10 14.2v.3" />,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  download: <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" />,
  upload: <path d="M10 13V4M6 7.5l4-4 4 4M4 16.5h12" />,
  trash: <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.8 10h6.4L14 6" />,
  edit: <path d="M4 16h3l8.5-8.5-3-3L4 13v3ZM11 6l3 3" />,
  swap: <path d="M4 7h11l-3-3M16 13H5l3 3" />,
  // classical bank front: pediment, columns, base
  // bars rising beside a pie slice
  chart: <path d="M3.5 16.5h13M5.5 16.5v-5M9 16.5V8M12.5 16.5v-3.5M12 3.5a4.5 4.5 0 1 1-3.6 1.8L12 8V3.5Z" />,
  bank: <path d="M3 7.5 10 3.5l7 4H3ZM4.5 7.5v7M8 7.5v7M12 7.5v7M15.5 7.5v7M3 14.5h14M2.5 16.5h15" />,
  flag: <path d="M5 17V3.5M5 4h9.5l-2 3 2 3H5" />,
  letter: <path d="M3 5h14v10H3V5Zm0 .5 7 5.5 7-5.5" />,
};

export function Icon({ name, size = 18, color = 'currentColor', style }: { name: IconName; size?: number; color?: string; style?: React.CSSProperties }) {
  const filled = name === 'fleet' || name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? color : 'none'}
      stroke={filled ? 'none' : color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
