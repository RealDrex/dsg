import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { currencySymbol, formatAmount, type DiscoveredDTO, type ProductSummaryDTO } from '@bestprice/core';
import { API_URL } from '../lib/api';
import { useApp } from '../lib/store';
import type { DiscoveryState } from '../lib/useDiscovery';
import { Badge, BrandLine, Chevron, Glass, Memoji, ProductThumb, Press, Row, StoreMark, Txt } from './kit';
import { C } from './theme';

/**
 * What the web search is really doing right now: the searches it runs and
 * the sites they reached (with their logos), plus elapsed time. Nothing
 * here is decorative — every line comes from the running job.
 */
export function LiveSearchPanel({ state, photoUri }: { state: Extract<DiscoveryState, { phase: 'running' }>; photoUri?: string | null }) {
  const { t, user } = useApp();
  const sway = useRef(new Animated.Value(0)).current;
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    const started = Date.now() - state.job.elapsedMs;
    const id = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 1000);
    return () => { loop.stop(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sway]);
  const { queries, sites } = state.job;
  const last = queries[queries.length - 1];
  const reading = sites.length > 0 && secs > 8 && queries.length >= 3;
  return (
    <Glass style={{ borderRadius: 22, padding: 16, gap: 12 }}>
      <Row style={{ gap: 12 }}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={{ width: 64, height: 64, borderRadius: 14 }} contentFit="cover" />
        ) : (
          <Animated.View style={{ transform: [{ rotate: sway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }) }] }}>
            <Memoji name={`${user?.avatar ?? 'm01'}_27`} size={64} />
          </Animated.View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size={14} weight="700">{reading ? t('liveReading') : state.label}</Txt>
          {last ? <Txt size={12.5} color={C.greenSoft} numberOfLines={2}>{`🔎 ${last}`}</Txt> : null}
          <Txt size={11.5} color={C.textDim}>{`${secs} ${t('liveSeconds')}${sites.length ? ` · ${sites.length} ${t('liveSites')}` : ''}`}</Txt>
        </View>
      </Row>
      {sites.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          {sites.slice(0, 18).map((d) => <StoreMark key={d} size={28} store={{ name: d, logoUrl: `${API_URL}/v1/logo/${d}`, brandColor: null }} />)}
        </Row>
      ) : null}
      <View style={{ height: 3, borderRadius: 2, backgroundColor: C.fill, overflow: 'hidden' }}>
        <View style={{ height: 3, width: `${Math.min(95, 8 + secs * 1.6)}%`, backgroundColor: C.green }} />
      </View>
    </Glass>
  );
}

/** A product result: photo, maker, name, lowest new price and how many sellers. */
export function ProductResult({ p, big }: { p: ProductSummaryDTO | DiscoveredDTO; big?: boolean }) {
  const { t, L, lang } = useApp();
  const size = big ? 88 : 56;
  const similar = 'match' in p && p.match === 'similar';
  return (
    <Press onPress={() => router.push(`/product/${p.id}`)}>
      <Glass style={{ borderRadius: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ProductThumb uri={p.imageUrl} category={p.category} size={size} radius={big ? 16 : 12} />
        <View style={{ flex: 1, gap: 4 }}>
          {similar ? <Badge label={t('similarItem')} bg="rgba(139,92,246,.2)" fg="#D0B8FF" /> : null}
          {big ? <BrandLine brand={p.brand} logoUrl={p.brandLogoUrl} /> : null}
          <Txt size={big ? 15 : 14} weight="600" numberOfLines={2}>{L(p.nameAr ?? p.name, p.name)}</Txt>
          {p.bestPriceMinor !== null ? (
            <Txt size={12.5} color={C.textMute}>
              {`${t('from')} `}
              <Txt size={big ? 16 : 14} weight="700" color={C.text}>{formatAmount(p.bestPriceMinor, p.currency)}</Txt>
              {` ${currencySymbol(p.currency, lang)} · ${p.offerCount === 1 ? t('oneSeller') : `${p.offerCount} ${t('sellers')}`}`}
            </Txt>
          ) : <Txt size={12} color={C.textMute}>{t('noPrice')}</Txt>}
        </View>
        <Chevron />
      </Glass>
    </Press>
  );
}
