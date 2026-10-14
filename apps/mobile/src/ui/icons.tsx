import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Icons traced from the design (24×24 stroke icons). */
type P = { size?: number; color?: string; width?: number; fill?: string; style?: object };

const S = ({ size = 22, color = '#F2F5F8', width = 1.9, fill = 'none', children, style }: P & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {children}
  </Svg>
);

export const IconSearch = (p: P) => <S {...p}><Circle cx="11" cy="11" r="7" /><Path d="m20 20-3.5-3.5" /></S>;
export const IconBell = (p: P) => <S {...p}><Path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" /><Path d="M10 20a2 2 0 0 0 4 0" /></S>;
export const IconScan = (p: P) => <S {...p}><Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></S>;
export const IconCamera = (p: P) => <S {...p}><Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><Circle cx="12" cy="13.5" r="3.5" /></S>;
export const IconTag = (p: P) => <S {...p}><Path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><Circle cx="8" cy="8" r="1.6" /></S>;
export const IconHeart = (p: P) => <S {...p}><Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></S>;
export const IconBookmark = (p: P) => <S {...p}><Path d="M6 4h12v16l-6-4-6 4z" /></S>;
export const IconHome = (p: P) => <S {...p}><Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></S>;
export const IconChat = (p: P) => (
  <S {...p}>
    <Path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    <Path d="M9 11h.01M12 11h.01M15 11h.01" strokeWidth={2.6} />
  </S>
);
export const IconTrend = (p: P) => <S {...p}><Path d="M4 17l5-5 4 3 7-8" /><Path d="M15 7h5v5" /></S>;
export const IconUser = (p: P) => <S {...p}><Circle cx="12" cy="8.5" r="3.5" /><Path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" /></S>;
/** Points left (RTL "forward"); flip for LTR. */
export const IconChevron = (p: P) => <S {...p}><Path d="M15 6l-6 6 6 6" /></S>;
export const IconBack = (p: P) => <S {...p}><Path d="M9 6l6 6-6 6" /></S>;
export const IconSend = (p: P) => <S {...p}><Path d="M19 12H5M11 6l-6 6 6 6" /></S>;
export const IconFlash = (p: P) => <S {...p}><Path d="M13 3 5 14h6l-1 7 8-11h-6z" /></S>;
export const IconGallery = (p: P) => <S {...p}><Rect x="4" y="4" width="16" height="16" rx="3" /><Circle cx="9" cy="9.5" r="1.6" /><Path d="m5 18 5-5 3 3 2-2 4 4" /></S>;
export const IconGlobe = (p: P) => <S {...p}><Circle cx="12" cy="12" r="9" /><Path d="M3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18" /></S>;
export const IconCheck = (p: P) => <S {...p}><Path d="M5 12.5 10 17 19 7" /></S>;
export const IconClose = (p: P) => <S {...p}><Path d="M6 6l12 12M18 6 6 18" /></S>;
export const IconPin = (p: P) => <S {...p}><Path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11Z" /><Circle cx="12" cy="10" r="2.2" /></S>;
export const IconShield = (p: P) => <S {...p}><Path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" /><Path d="m9 12 2 2 4-4" /></S>;

export const Sparkle = ({ size = 18, color = '#3EE09A' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z" />
  </Svg>
);
