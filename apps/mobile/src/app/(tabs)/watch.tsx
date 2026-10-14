import React, { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAmount, type NotificationDTO, type WatchItemDTO } from '@bestprice/core';
import { api } from '../../lib/api';
import { ago } from '../../lib/i18n';
import { useApp } from '../../lib/store';
import { Badge, Glass, Hero, Press, Row, Spinner, Txt, Screen } from '../../ui/kit';
import { C, GLOWS } from '../../ui/theme';

export default function Watch() {
  const { t, lang, dataVersion, bump, user } = useApp();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<WatchItemDTO[] | null>(null);
  const [alerts, setAlerts] = useState<NotificationDTO[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [w, n] = await Promise.all([api.watches(), api.notifications()]);
      setItems(w);
      setAlerts(n.filter((x) => !x.readAt).slice(0, 3));
      const unread = n.filter((x) => !x.readAt).map((x) => x.id);
      if (unread.length) void api.readNotifications(unread);
    } catch {
      setItems((x) => x ?? []);
    }
  }, [user?.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load, dataVersion]));

  const remove = (w: WatchItemDTO) => {
    const go = async () => { await api.removeWatch(w.id).catch(() => {}); bump(); void load(); };
    if (Platform.OS === 'web') return void go();
    Alert.alert(w.product.name, t('remove') + '?', [{ text: t('cancel'), style: 'cancel' }, { text: t('remove'), style: 'destructive', onPress: go }]);
  };

  return (
    <Screen>
    <ScrollView contentContainerStyle={{ paddingBottom: 130, gap: 18 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.green} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Hero radius={38} height={200} style={{ paddingTop: insets.top + 14, paddingHorizontal: 24, paddingBottom: 30, gap: 6 }}>
        <Txt size={40} weight="800" color={C.ink} display style={{ lineHeight: 44 }}>{t('watchTitle')}</Txt>
        <Txt size={13.5} weight="500" color="rgba(6,33,15,.75)" lh={1.6}>{t('watchSub')}</Txt>
      </Hero>

      <View style={{ paddingHorizontal: 20, gap: 18 }}>
        {alerts.map((a) => (
          <Press key={a.id} onPress={() => a.productId && router.push(`/product/${a.productId}`)}>
            <View style={{ borderRadius: 18, padding: 14, backgroundColor: 'rgba(62,224,154,.12)', borderWidth: 1, borderColor: 'rgba(62,224,154,.35)', gap: 4 }}>
              <Txt size={13.5} weight="700" color={C.greenSoft}>{a.title}</Txt>
              <Txt size={12} color={C.textSoft} lh={1.5}>{a.body}</Txt>
              <Txt size={11} color={C.textDim}>{ago(lang, a.createdAt)}</Txt>
            </View>
          </Press>
        ))}

        {items === null ? <Spinner /> : null}
        {items?.length === 0 ? <Txt center color={C.textMute} lh={1.7}>{t('watchEmpty')}</Txt> : null}

        {items?.map((w, i) => {
          const cur = w.product.currency;
          const pct = w.hit ? 100 : w.currentMinor === null ? 6 : Math.max(6, Math.round(((w.startMinor - w.currentMinor) / Math.max(1, w.startMinor - w.targetMinor)) * 100));
          const fresh = Date.now() - new Date(w.createdAt).getTime() < 3600_000;
          return (
            <Press key={w.id} onPress={() => router.push(`/product/${w.product.id}`)} onLongPress={() => remove(w)}>
              <Glass style={{ borderRadius: 28, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 14, gap: 12, borderColor: w.hit ? 'rgba(62,224,154,.45)' : C.line }}>
                <View style={{ height: 150, borderRadius: 20, backgroundColor: C.card, overflow: 'hidden' }}>
                  <LinearGradient colors={[GLOWS[i % 4]!, 'transparent']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', inset: 0, opacity: 0.6 }} />
                  <Txt size={10} color="rgba(255,255,255,.45)" ltr style={{ position: 'absolute', top: 10, left: 12 }}>{t('productPhoto')}</Txt>
                </View>
                <Row style={{ gap: 12 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Txt size={14} weight="600">{w.product.name}</Txt>
                    <Txt size={12} color={C.textMute}>{w.currentStore ? `${w.currentStore} · ${t('lowestFinal')}` : t('noPrice')}</Txt>
                  </View>
                  <Badge label={w.hit ? t('targetHit') : w.currentMinor !== null ? (lang === 'ar' ? `${t('toGo')} ${formatAmount(w.currentMinor - w.targetMinor, cur)}` : `${formatAmount(w.currentMinor - w.targetMinor, cur)} ${t('toGo')}`) : '—'}
                    bg={w.hit ? 'rgba(62,224,154,.14)' : C.fill2} fg={w.hit ? C.greenSoft : C.textSoft} />
                </Row>
                <View style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt size={12} color={C.textMute}>{t('now')} <Txt size={15} weight="600">{w.currentMinor !== null ? formatAmount(w.currentMinor, cur) : '—'}</Txt></Txt>
                    <Txt size={12} color={C.textMute}>{t('target')} <Txt size={12} weight="600">{formatAmount(w.targetMinor, cur)}</Txt></Txt>
                  </Row>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                    {w.hit
                      ? <View style={{ width: '100%', height: '100%', backgroundColor: C.green }} />
                      : <LinearGradient colors={[C.violet, C.sky, C.green]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 3 }} />}
                  </View>
                  <Txt size={11.5} color={C.textDim}>{w.hit && w.hitAt ? `${t('targetHit')} · ${ago(lang, w.hitAt)}` : fresh ? t('addedNow') : `${t('statWatching')} · ${ago(lang, w.createdAt)}`}</Txt>
                </View>
              </Glass>
            </Press>
          );
        })}
        <Txt center size={12} color={C.textDim} lh={1.7} style={{ paddingHorizontal: 10 }}>{t('watchFoot')}</Txt>
      </View>
    </ScrollView>
    </Screen>
  );
}
