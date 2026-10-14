import React from 'react';
import { View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../lib/store';
import type { StrKey } from '../../lib/i18n';
import { IconChat, IconHome, IconScan, IconTrend, IconUser } from '../../ui/icons';
import { Press, Txt } from '../../ui/kit';
import { C, CTA } from '../../ui/theme';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const ITEMS: { name: string; label: StrKey; Icon: typeof IconHome }[] = [
  { name: 'index', label: 'tabHome', Icon: IconHome },
  { name: 'assistant', label: 'tabAssistant', Icon: IconChat },
  { name: 'watch', label: 'tabWatch', Icon: IconTrend },
  { name: 'profile', label: 'tabProfile', Icon: IconUser },
];

/** Floating glass tab bar with the scan button in the middle (design 2A). */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const tab = (it: (typeof ITEMS)[number]) => {
    const on = current === it.name;
    const color = on ? C.green : C.textDim;
    return (
      <Press key={it.name} onPress={() => navigation.navigate(it.name)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t(it.label)}
        style={{ width: 62, alignItems: 'center', gap: 4 }}>
        <it.Icon size={22} color={color} />
        <Txt center size={10.5} weight="600" color={color}>{t(it.label)}</Txt>
      </Press>
    );
  };
  return (
    <View style={{ position: 'absolute', left: 14, right: 14, bottom: Math.max(insets.bottom, 12) + 4, height: 66, borderRadius: 33, overflow: 'hidden', borderWidth: 1, borderColor: C.lineSoft }}>
      <BlurView intensity={40} tint="dark" style={{ position: 'absolute', inset: 0 }} />
      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(22,28,36,.62)' }} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 6 }}>
        {tab(ITEMS[0]!)}
        {tab(ITEMS[1]!)}
        <Press onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel={t('scanTitle')}>
          <LinearGradient colors={[...CTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' }}>
            <IconScan size={24} color={C.ink} width={2} />
          </LinearGradient>
        </Press>
        {tab(ITEMS[2]!)}
        {tab(ITEMS[3]!)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }} tabBar={(p) => <FloatingTabBar {...p} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="assistant" />
      <Tabs.Screen name="watch" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
