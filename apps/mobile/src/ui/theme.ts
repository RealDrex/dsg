/** Design tokens, taken from the Best Price 2A design. */
export const C = {
  bg: '#000000',
  text: '#F2F5F8',
  textSoft: '#C3CCD6',
  textMute: '#8E8E93',
  textDim: '#636366',
  ink: '#06210F', // text on the green gradient
  ink2: '#0A0E13',
  green: '#3EE09A',
  greenSoft: '#7EF2C0',
  greenDeep: '#12B76A',
  teal: '#2BC9B4',
  sky: '#38BDF8',
  skyLight: '#64D2FF',
  violet: '#8B5CF6',
  purple: '#BF5AF2',
  orange: '#FF9F0A',
  amber: '#F2B866',
  amberBg: 'rgba(232,163,61,.12)',
  amberText: '#EBDCC3',
  coral: '#FF8A5C',
  red: '#D9534F',
  pink: '#FF375F',
  warn: '#E8A33D',
  glass: 'rgba(28,28,30,0.72)',
  glassSolid: '#15181D',
  card: '#14171C',
  line: 'rgba(255,255,255,0.10)',
  lineSoft: 'rgba(255,255,255,0.08)',
  lineFaint: 'rgba(255,255,255,0.07)',
  fill: 'rgba(255,255,255,0.06)',
  fill2: 'rgba(255,255,255,0.08)',
} as const;

export const HERO = ['#3EE09A', '#2BC9B4', '#38BDF8'] as const;
export const HERO_LOC = [0, 0.6, 1] as const;
export const CTA = ['#3EE09A', '#38BDF8'] as const;

export const R = { sm: 10, md: 14, lg: 18, xl: 24, xxl: 28, hero: 40 } as const;

/** Display font: system SF on iOS; Arabic falls back to the platform Arabic face. */
export const F = {
  display: { fontWeight: '800' as const, letterSpacing: -0.5 },
  semibold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
};

export const GLOWS = ['rgba(62,224,154,.5)', 'rgba(56,189,248,.5)', 'rgba(139,92,246,.5)', 'rgba(255,159,10,.42)'];

/** Avatar halo colours (index-aligned with the 15 memoji per gender). */
export const AVATAR_GLOW = [
  'rgba(10,132,255,.55)', 'rgba(255,55,95,.5)', 'rgba(48,209,88,.5)', 'rgba(191,90,242,.55)', 'rgba(255,159,10,.55)',
  'rgba(100,210,255,.5)', 'rgba(255,69,58,.5)', 'rgba(255,214,10,.45)', 'rgba(94,92,230,.55)', 'rgba(48,209,88,.45)',
  'rgba(255,159,10,.5)', 'rgba(172,142,104,.6)', 'rgba(10,132,255,.45)', 'rgba(255,55,95,.45)', 'rgba(191,90,242,.45)',
];
export const AVATARS = {
  m: ['m01', 'm02', 'm03', 'm05', 'm06', 'm09', 'm10', 'm13', 'm14', 'm15', 'm17', 'm21', 'm22', 'm25', 'm26'],
  f: ['f01', 'f02', 'f03', 'f05', 'f06', 'f09', 'f10', 'f13', 'f14', 'f15', 'f17', 'f18', 'f21', 'f22', 'f25'],
};
