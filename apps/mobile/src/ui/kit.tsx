import React, { useEffect, useId, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useApp } from '../lib/store';
import { AVATAR_GLOW, C, CTA, HERO, HERO_LOC, R } from './theme';
import { MEMOJI } from './memoji';
import { IconChevron } from './icons';
import { brandMarkFor, storeMarkFor, type BrandMark } from './brandMarks';

/* --------------------------------- Text --------------------------------- */

type TxtProps = TextProps & {
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  display?: boolean;
  center?: boolean;
  /** force LTR rendering (codes, model numbers) */
  ltr?: boolean;
  lh?: number;
};

export function Txt({ size = 14, weight = '400', color = C.text, display, center, ltr, lh, style, ...rest }: TxtProps) {
  const { rtl } = useApp();
  const align: TextStyle['textAlign'] = center ? 'center' : ltr ? (rtl ? 'right' : 'left') : rtl ? 'right' : 'left';
  return (
    <Text
      {...rest}
      style={[
        { fontSize: size, fontWeight: weight, color, textAlign: align, writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr' },
        lh ? { lineHeight: size * lh } : null,
        display ? { letterSpacing: -0.02 * size } : null,
        style,
      ]}
    />
  );
}

/* ------------------------------- Layout ------------------------------- */

export const Row = ({ style, ...p }: React.ComponentProps<typeof View>) => <View {...p} style={[{ flexDirection: 'row', alignItems: 'center' }, style]} />;

export function Glass({ style, blur, children, ...rest }: React.ComponentProps<typeof View> & { blur?: boolean }) {
  return (
    <View {...rest} style={[styles.glass, style]}>
      {blur ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      {children}
    </View>
  );
}

/** Green gradient header with the brand's flowing white curves. */
export function Hero({ children, style, radius = 40, height = 300 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number; height?: number }) {
  return (
    <LinearGradient colors={[...HERO]} locations={[...HERO_LOC]} style={[{ borderBottomLeftRadius: radius, borderBottomRightRadius: radius, overflow: 'hidden' }, style]}>
      <Svg viewBox={`0 0 390 ${height}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={`M-30 ${height * 0.62} C 70 ${height * 0.38}, 150 ${height * 0.96}, 240 ${height * 0.7} S 360 ${height * 0.44}, 420 ${height * 0.6}`} fill="none" stroke="rgba(255,255,255,.34)" strokeWidth={8} strokeLinecap="round" />
        <Path d={`M210 ${height * 1.08} C 260 ${height * 0.74}, 330 ${height * 0.9}, 420 ${height * 0.56}`} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={5} strokeLinecap="round" />
      </Svg>
      {children}
    </LinearGradient>
  );
}

/** App background: soft green/blue glows, coloured light trails and blurred orbs. */
export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 390 844">
        <Defs>
          <RadialGradient id="top" cx="195" cy="0" rx="312" ry="270" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#3EE09A" stopOpacity={0.11} />
            <Stop offset="0.7" stopColor="#3EE09A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bot" cx="195" cy="844" rx="273" ry="236" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#0A84FF" stopOpacity={0.1} />
            <Stop offset="0.7" stopColor="#0A84FF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="orbG" cx="30" cy="500" r="170" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#3EE09A" stopOpacity={0.16} />
            <Stop offset="1" stopColor="#3EE09A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="orbV" cx="370" cy="700" r="190" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#8B5CF6" stopOpacity={0.2} />
            <Stop offset="1" stopColor="#8B5CF6" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="390" height="844" fill="#000" />
        <Rect x="0" y="0" width="390" height="844" fill="url(#top)" />
        <Rect x="0" y="0" width="390" height="844" fill="url(#bot)" />
        <Circle cx="30" cy="500" r="170" fill="url(#orbG)" />
        <Circle cx="370" cy="700" r="190" fill="url(#orbV)" />
        <Path d="M400 360 C 300 440, 390 510, 310 580 S 340 670, 400 690" fill="none" stroke="#8B5CF6" strokeOpacity={0.45} strokeWidth={4} strokeLinecap="round" />
        <Path d="M-20 520 C 80 570, 10 650, 90 700 S 60 770, -20 790" fill="none" stroke="#3EE09A" strokeOpacity={0.38} strokeWidth={3.5} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Opaque screen container with the app backdrop (screens must not see each other through). */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop />
      {children}
    </View>
  );
}

/* ------------------------------- Controls ------------------------------- */

export function Press({ style, children, ...p }: PressableProps & { style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable {...p} style={({ pressed }) => [style as ViewStyle, pressed ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : null]}>
      {children}
    </Pressable>
  );
}

export function GradientButton({ label, onPress, style, small, loading, disabled }: { label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; small?: boolean; loading?: boolean; disabled?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={label} style={[{ borderRadius: small ? 18 : 14, overflow: 'hidden', opacity: disabled ? 0.5 : 1 }, style]}>
      <LinearGradient colors={[...CTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: small ? 36 : 48, paddingHorizontal: small ? 16 : 18, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator color={C.ink} /> : <Txt center size={small ? 13 : 13.5} weight="700" color={C.ink}>{label}</Txt>}
      </LinearGradient>
    </Press>
  );
}

export function GhostButton({ label, onPress, style }: { label: string; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, style]}>
      <Txt center size={13.5} weight="600">{label}</Txt>
    </Press>
  );
}

export function Chip({ label, selected, onPress, big }: { label: string; selected?: boolean; onPress?: () => void; big?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={{ paddingVertical: big ? 10 : 7, paddingHorizontal: big ? 14 : 11, borderRadius: 14, borderWidth: 1, borderColor: selected ? C.green : C.lineSoft, backgroundColor: selected ? 'rgba(62,224,154,.16)' : C.fill }}>
      <Txt size={big ? 13.5 : 12.5} weight="500" color={selected ? C.greenSoft : C.text}>{label}</Txt>
    </Press>
  );
}

/** Green suggestion chip used by the advisor. */
export function SuggestChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(62,224,154,.35)', backgroundColor: 'rgba(62,224,154,.1)' }}>
      <Txt size={12.5} weight="600" color={C.greenSoft}>{label}</Txt>
    </Press>
  );
}

export function Segmented<K extends string>({ items, value, onChange, light }: { items: { k: K; label: string }[]; value: K; onChange: (k: K) => void; light?: boolean }) {
  return (
    <Row style={{ backgroundColor: 'rgba(255,255,255,.07)', borderRadius: 13, padding: 3, gap: 2 }}>
      {items.map((it) => {
        const on = it.k === value;
        return (
          <Press key={it.k} onPress={() => onChange(it.k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: light ? undefined : 1, paddingVertical: 8, paddingHorizontal: light ? 12 : 4, borderRadius: 10, backgroundColor: on ? (light ? 'rgba(255,255,255,.16)' : '#fff') : 'transparent' }}>
            <Txt center size={12.5} weight="600" color={on ? (light ? C.text : C.ink2) : C.textMute}>{it.label}</Txt>
          </Press>
        );
      })}
    </Row>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  const { rtl } = useApp();
  // Knob sits at the "end" when on: right in LTR, left in RTL (matches iOS RTL switches).
  const knobEnd = on ? (rtl ? { left: 3 } : { right: 3 }) : rtl ? { right: 3 } : { left: 3 };
  return (
    <Press onPress={() => onChange(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: on ? C.green : 'rgba(255,255,255,.18)' }}>
      <View style={[{ position: 'absolute', top: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }, knobEnd]} />
    </Press>
  );
}

export function Chevron({ size = 14, color = C.textMute }: { size?: number; color?: string }) {
  const { rtl } = useApp();
  return <IconChevron size={size} color={color} width={2.2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <Txt size={22} weight="800" display>{title}</Txt>
      {action ? <Press onPress={onAction}><Txt size={13} weight="600" color={C.green}>{action}</Txt></Press> : null}
    </Row>
  );
}

/* ------------------------------- Identity ------------------------------- */

export function Memoji({ name, size, style }: { name: string; size: number; style?: StyleProp<ViewStyle> }) {
  const src = MEMOJI[name] ?? MEMOJI.m01;
  return <Image source={src} style={[{ width: size, height: size }, style as object]} contentFit="contain" accessibilityIgnoresInvertColors />;
}

export function avatarGlow(avatar: string): string {
  const idx = Number(avatar.slice(1)) || 1;
  const list = avatar.startsWith('f') ? ['01', '02', '03', '05', '06', '09', '10', '13', '14', '15', '17', '18', '21', '22', '25'] : ['01', '02', '03', '05', '06', '09', '10', '13', '14', '15', '17', '21', '22', '25', '26'];
  const i = Math.max(0, list.indexOf(String(idx).padStart(2, '0')));
  return AVATAR_GLOW[i] ?? AVATAR_GLOW[0]!;
}

/** Circular colour halo behind a memoji. */
const useSvgId = () => 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');

export function Halo({ color, size }: { color: string; size: number }) {
  const id = useSvgId();
  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="58%" r="50%">
          <Stop offset="0" stopColor={color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)')} stopOpacity={0.55} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M5 16v-6a5 5 0 0 1 5-5h6M32 5h6a5 5 0 0 1 5 5v6M43 32v6a5 5 0 0 1-5 5h-6M16 43h-6a5 5 0 0 1-5-5v-6" fill="none" stroke="#F2F5F8" strokeWidth={3.8} strokeLinecap="round" />
      <Circle cx="24" cy="24" r="9.5" fill="#3EE09A" />
      <Circle cx="27.6" cy="20.4" r="2.6" fill="#fff" opacity={0.9} />
    </Svg>
  );
}

export function LogoTile({ size = 52 }: { size?: number }) {
  const id = useSvgId();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#090D12', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={id + "a"} cx="85%" cy="5%" r="90%"><Stop offset="0" stopColor="#38BDF8" stopOpacity={0.5} /><Stop offset="0.55" stopColor="#38BDF8" stopOpacity={0} /></RadialGradient>
          <RadialGradient id={id + "b"} cx="5%" cy="100%" r="80%"><Stop offset="0" stopColor="#3EE09A" stopOpacity={0.35} /><Stop offset="0.55" stopColor="#3EE09A" stopOpacity={0} /></RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id}a)`} />
        <Rect width={size} height={size} fill={`url(#${id}b)`} />
      </Svg>
      <LogoMark size={size * 0.62} />
    </View>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '600', color: C.text, writingDirection: 'ltr' }}>
      Best<Text style={{ color: C.green }}>Price</Text>
    </Text>
  );
}

/**
 * Store mark: the store's logo (its site icon, served by our API) on a white
 * tile. If there is no logo or it fails to load, the store's wordmark in its
 * brand colour — so a mark always shows something recognisable.
 */
/** An official brand mark drawn from its vector path (bundled, works offline). */
export function MarkIcon({ mark, size }: { mark: BrandMark; size: number }) {
  const fill = isLightColor(mark.hex) ? '#111' : mark.hex;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={mark.title}>
      <Path d={mark.path} fill={fill} />
    </Svg>
  );
}

export function StoreMark({ store, size = 42 }: { store: { name: string; logoUrl?: string | null; brandColor: string | null; domain?: string | null }; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [store.logoUrl]);
  const radius = size * 0.29;
  // A logo an admin set wins; then the bundled official mark; then the site's icon from our server.
  const custom = !!store.logoUrl && !store.logoUrl.includes('/v1/logo/');
  const mark = custom ? null : storeMarkFor(store.domain);
  if (mark) {
    return (
      <View accessibilityLabel={store.name} style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <MarkIcon mark={mark} size={size * 0.62} />
      </View>
    );
  }
  if (store.logoUrl && !failed) {
    return (
      <View accessibilityLabel={store.name} style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Image source={{ uri: store.logoUrl }} style={{ width: size * 0.7, height: size * 0.7 }} contentFit="contain" onError={() => setFailed(true)} recyclingKey={store.logoUrl} />
      </View>
    );
  }
  const bg = store.brandColor ?? '#2A3038';
  const light = isLightColor(bg);
  // Domains ("shop.example.com") show their first label: "shop".
  const word = (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(store.name) ? store.name.split('.')[0]! : store.name.split(' ')[0]!) || store.name;
  return (
    <View accessibilityLabel={store.name} style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: size * 0.05 }}>
      <Text numberOfLines={1}
        style={{ color: light ? '#1A1A1A' : '#fff', fontWeight: '800', letterSpacing: -0.3, fontSize: Math.min(size * 0.34, (size * 0.84) / (word.length * 0.68)), writingDirection: 'ltr' }}>
        {word}
      </Text>
    </View>
  );
}

/** Small brand logo + name ("Made by"), when we know the maker's site. */
export function BrandLine({ brand, logoUrl, size = 18 }: { brand: string | null; logoUrl: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!brand) return null;
  const mark = brandMarkFor(brand);
  return (
    <Row style={{ gap: 6 }}>
      {mark ? (
        <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <MarkIcon mark={mark} size={size * 0.74} />
        </View>
      ) : logoUrl && !failed ? (
        <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Image source={{ uri: logoUrl }} style={{ width: size * 0.78, height: size * 0.78 }} contentFit="contain" onError={() => setFailed(true)} />
        </View>
      ) : null}
      <Txt size={12} weight="600" color={C.textSoft} ltr>{brand}</Txt>
    </Row>
  );
}

function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
}

const CATEGORY_GLYPH: Record<string, string> = {
  laptop: '💻', phone: '📱', tablet: '📲', headphones: '🎧', watch: '⌚', tv: '📺', camera: '📷', gaming: '🎮',
  coffee: '☕', home: '🏠', beauty: '🧴', grocery: '🛒', fashion: '👜', car: '🚗',
};

/** Product photo when we have one, otherwise a category glyph tile. */
export function ProductThumb({ uri, category, size, radius = 12 }: { uri?: string | null; category?: string | null; size: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  if (uri && !failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: '#fff' }}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={150} recyclingKey={uri} onError={() => setFailed(true)} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <LinearGradient colors={['rgba(62,224,154,.16)', 'rgba(139,92,246,.18)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text style={{ fontSize: size * 0.46 }}>{CATEGORY_GLYPH[category ?? ''] ?? '📦'}</Text>
    </View>
  );
}

/** Striped placeholder used where a real product photo isn't available yet. */
export function PhotoPlaceholder({ size, radius = 12 }: { size: number; radius?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,.07)' }}>
      <Svg width={size} height={size}>
        {Array.from({ length: Math.ceil((size * 2) / 10) }, (_, i) => (
          <Path key={i} d={`M${i * 10 - size} ${size} L${i * 10} 0`} stroke="rgba(255,255,255,.05)" strokeWidth={5} />
        ))}
      </Svg>
    </View>
  );
}

export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: bg, alignSelf: 'flex-start' }}>
      <Txt size={10.5} weight="700" color={fg}>{label}</Txt>
    </View>
  );
}

export function Spinner() {
  return <ActivityIndicator color={C.green} style={{ marginVertical: 24 }} />;
}

const styles = StyleSheet.create({
  glass: { backgroundColor: C.glass, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, overflow: 'hidden' },
});
