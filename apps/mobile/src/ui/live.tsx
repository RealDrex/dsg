import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { currencySymbol, formatAmount, type BuyOptionDTO, type CurrencyCode, type DiscoveredDTO, type ProductSummaryDTO } from '@bestprice/core';
import { API_URL } from '../lib/api';
import { etaText } from '../lib/i18n';
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
          {sites.slice(0, 18).map((d) => <StoreMark key={d} size={28} store={{ name: d, domain: d, logoUrl: `${API_URL}/v1/logo/${d}`, brandColor: null }} />)}
        </Row>
      ) : null}
      <View style={{ height: 3, borderRadius: 2, backgroundColor: C.fill, overflow: 'hidden' }}>
        <View style={{ height: 3, width: `${Math.min(95, 8 + secs * 1.6)}%`, backgroundColor: C.green }} />
      </View>
    </Glass>
  );
}

/** "649 ر.س · أمازون · يوصلك بكرة" — one buying option in one line. */
export function OptionLine({ label, o, currency, strong }: { label: string; o: BuyOptionDTO; currency: CurrencyCode; strong?: boolean }) {
  const { t, L, lang } = useApp();
  const eta = etaText(lang, o.etaHours);
  return (
    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
      <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 7, backgroundColor: strong ? 'rgba(62,224,154,.16)' : 'rgba(56,189,248,.14)' }}>
        <Txt size={10.5} weight="700" color={strong ? C.greenSoft : '#9BDCFB'}>{label}</Txt>
      </View>
      <Txt size={strong ? 14 : 12.5} weight="700" color={C.text}>{`${o.finalIsEstimate ? '≥ ' : ''}${formatAmount(o.finalMinor, currency)} ${currencySymbol(currency, lang)}`}</Txt>
      <Txt size={12} color={C.textMute} numberOfLines={1} style={{ flexShrink: 1 }}>{[L(o.storeNameAr, o.storeName), eta ? `${t('arrives')} ${eta}` : null].filter(Boolean).join(' · ')}</Txt>
    </Row>
  );
}

/** A product result: photo, maker, name, the best option (and the fastest), price range and sellers. */
export function ProductResult({ p, big }: { p: ProductSummaryDTO | DiscoveredDTO; big?: boolean }) {
  const { t, L, lang } = useApp();
  const size = big ? 92 : 64;
  const similar = 'match' in p && p.match === 'similar';
  const range = p.priceRange && p.priceRange.maxMinor > p.priceRange.minMinor ? p.priceRange : null;
  return (
    <Press onPress={() => router.push(`/product/${p.id}`)}>
      <Glass style={{ borderRadius: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ProductThumb uri={p.imageUrl} category={p.category} size={size} radius={big ? 16 : 14} />
        <View style={{ flex: 1, gap: 5 }}>
          {similar ? <Badge label={t('similarItem')} bg="rgba(139,92,246,.2)" fg="#D0B8FF" /> : null}
          <BrandLine brand={p.brand} logoUrl={p.brandLogoUrl} />
          <Txt size={big ? 15 : 14} weight="600" numberOfLines={2}>{L(p.nameAr ?? p.name, p.name)}</Txt>
          {p.best ? <OptionLine label={t('bestOption')} o={p.best} currency={p.currency} strong /> : <Txt size={12} color={C.textMute}>{t('noPrice')}</Txt>}
          {p.fastest ? <OptionLine label={t('fastestOption')} o={p.fastest} currency={p.currency} /> : null}
          {p.best ? (
            <Txt size={11.5} color={C.textDim}>
              {[range ? `${t('priceRange')} ${formatAmount(range.minMinor, p.currency)}–${formatAmount(range.maxMinor, p.currency)}` : null,
                p.offerCount === 1 ? t('oneSeller') : `${p.offerCount} ${t('sellers')}`].filter(Boolean).join(' · ')}
            </Txt>
          ) : null}
        </View>
        <Chevron />
      </Glass>
    </Press>
  );
}
