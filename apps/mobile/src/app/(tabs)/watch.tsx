import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { type NotificationDTO, type WatchItemDTO } from '@bestprice/core';
import { api } from '../../lib/api';
import { ago } from '../../lib/i18n';
import { useApp } from '../../lib/store';
import { BrandLine, Glass, Hero, Press, ProductThumb, Row, Spinner, Txt, Screen } from '../../ui/kit';
import { TargetProgress } from '../../ui/target';
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
  /** Asks the server to re-check prices of watched products now, then shows the result. */
  const refreshAll = useCallback(async () => {
    try {
      const r = await api.refreshWatches();
      setItems(r.watches);
    } catch { await load(); }
  }, [load]);

  // On open: show what we have, then re-check prices. While open: re-read every minute.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    void load().then(() => refreshAll());
    return () => setFocused(false);
  }, [load, refreshAll, dataVersion]));
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [focused, load]);

  const remove = (w: WatchItemDTO) => {
    const go = async () => { await api.removeWatch(w.id).catch(() => {}); bump(); void load(); };
    if (Platform.OS === 'web') return void go();
    Alert.alert(w.product.name, t('remove') + '?', [{ text: t('cancel'), style: 'cancel' }, { text: t('remove'), style: 'destructive', onPress: go }]);
  };

  return (
    <Screen>
    <ScrollView contentContainerStyle={{ paddingBottom: 130, gap: 18 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.green} onRefresh={async () => { setRefreshing(true); await refreshAll(); setRefreshing(false); }} />}>
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

        {items?.map((w, i) => (
          <Press key={w.id} onPress={() => router.push(`/product/${w.product.id}`)} onLongPress={() => remove(w)}>
            <Glass style={{ borderRadius: 28, padding: 12, gap: 12, borderColor: w.hit ? 'rgba(62,224,154,.45)' : C.line }}>
              <Row style={{ gap: 12 }}>
                <View style={{ borderRadius: 18, overflow: 'hidden' }}>
                  <LinearGradient colors={[GLOWS[i % 4]!, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', inset: 0, opacity: 0.5 }} />
                  <ProductThumb uri={w.product.imageUrl} category={w.product.category} size={84} radius={18} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <BrandLine brand={w.product.brand} logoUrl={w.product.brandLogoUrl} />
                  <Txt size={14.5} weight="700" numberOfLines={2}>{lang === 'ar' ? w.product.nameAr ?? w.product.name : w.product.name}</Txt>
                  <Txt size={12} color={C.textMute} numberOfLines={1}>{w.currentStore ? `${t('lowestFinal')} · ${w.currentStore}` : t('noPrice')}</Txt>
                </View>
              </Row>
              <TargetProgress startMinor={w.startMinor} currentMinor={w.currentMinor} targetMinor={w.targetMinor} currency={w.product.currency}
                lowestMinor={w.lowestMinor} checkedAt={w.checkedAt} />
            </Glass>
          </Press>
        ))}
        <Txt center size={12} color={C.textDim} lh={1.7} style={{ paddingHorizontal: 10 }}>{t('watchFoot')}</Txt>
      </View>
    </ScrollView>
    </Screen>
  );
}
