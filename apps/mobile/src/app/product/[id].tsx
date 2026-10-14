import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import Svg, { Circle, Line as SvgLine, Polygon, Polyline } from 'react-native-svg';
import { displayGtin, formatAmount, currencySymbol, type HistoryResponse, type OfferDTO, type OffersResponse, type ProductDTO, type SortMode } from '@bestprice/core';
import { api } from '../../lib/api';
import { ago, type StrKey } from '../../lib/i18n';
import { registerForPush } from '../../lib/push';
import { useApp } from '../../lib/store';
import { IconBack, IconBookmark, Sparkle } from '../../ui/icons';
import { Glass, GradientButton, ProductThumb, Press, Row, Segmented, Spinner, StoreMark, Txt, Screen } from '../../ui/kit';
import { C, CTA } from '../../ui/theme';

const SORT_WHY: Record<SortMode, StrKey> = { value: 'whyValue', cheapest: 'whyCheap', nearest: 'whyNear', fastest: 'whyFast' };

export default function Product() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, L, lang, rtl, user, showToast, bump, startProductChat } = useApp();
  const insets = useSafeAreaInsets();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [sort, setSort] = useState<SortMode>(user?.priority ?? 'value');
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(false);
    Promise.all([api.product(id), api.history(id), api.watches()])
      .then(([p, h, ws]) => {
        setProduct(p);
        setHistory(h);
        const w = ws.find((x) => x.product.id === id);
        setWatchId(w?.id ?? null);
        setTarget(w?.targetMinor ?? null);
      })
      .catch(() => setError(true));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.offers(id, sort, loc).then(setOffers).catch(() => setError(true));
  }, [id, sort, loc]);

  const pickSort = async (s: SortMode) => {
    setSort(s);
    if (s === 'nearest' && !loc) {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch { /* distance stays unknown */ }
    }
  };

  const cur = offers?.currency ?? product?.currency ?? 'SAR';
  const sym = currencySymbol(cur, lang);
  const cheapest = useMemo(() => offers ? [...offers.offers].filter((o) => o.confidence !== 'stale').sort((a, b) => a.finalMinor - b.finalMinor)[0] : undefined, [offers]);
  const [valueTop, setValueTop] = useState<OfferDTO | undefined>();
  useEffect(() => {
    if (!id) return;
    api.offers(id, 'value', loc).then((r) => setValueTop(r.offers[0])).catch(() => {});
  }, [id, loc]);

  const toggleWatch = useCallback(async () => {
    if (!product) return;
    if (watchId) {
      await api.removeWatch(watchId).catch(() => {});
      setWatchId(null);
      setTarget(null);
    } else {
      const base = cheapest?.finalMinor ?? product.bestPriceMinor ?? 0;
      const unit = 100;
      const tgt = Math.max(unit, Math.round((base * 0.92) / (50 * unit)) * 50 * unit);
      try {
        const r = await api.addWatch(product.id, tgt);
        setWatchId(r.id);
        setTarget(tgt);
        showToast({ title: t('watching'), sub: `${t('notifyAt')} ${formatAmount(tgt, cur)} ${sym}` });
        void registerForPush();
      } catch (e) {
        showToast({ title: (e as Error).message });
      }
    }
    bump();
  }, [product, watchId, cheapest, cur, sym, showToast, t, bump]);

  const changeTarget = async (delta: number) => {
    if (!watchId || target === null) return;
    const next = Math.max(100, target + delta);
    setTarget(next);
    await api.updateWatch(watchId, next).catch(() => {});
    bump();
  };

  const buy = async (o: OfferDTO) => {
    if (o.channel === 'local' && o.branch) {
      const q = `${o.branch.lat},${o.branch.lng}`;
      const url = Platform.select({ ios: `maps:?daddr=${q}`, default: `https://www.google.com/maps/dir/?api=1&destination=${q}` });
      await Linking.openURL(url!).catch(() => {});
      return;
    }
    if (o.buyUrl) await WebBrowser.openBrowserAsync(o.buyUrl).catch(() => {});
  };

  const bought = async (o: OfferDTO) => {
    try {
      const r = await api.purchase(o.id);
      showToast({ title: r.savedMinor > 0 ? `${t('youSaved')} ${formatAmount(r.savedMinor, cur)} ${sym}` : t('purchaseRecorded'), sub: t('vsHighest') });
      bump();
    } catch { /* ignore */ }
  };

  if (error && !product) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 60, padding: 24, gap: 16 }}>
        <Txt center color={C.textMute}>{t('errorGeneric')}</Txt>
        <GradientButton label={t('close')} onPress={() => router.back()} />
      </View>
    );
  }

  const isDemo = !!offers?.offers.some((o) => o.isDemo);
  const hasWebPrices = !!offers?.offers.some((o) => o.sourceType === 'web_search');
  const chart = history ? buildChart(history) : null;

  return (
    <Screen>
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8 }}>
        <Press onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel={t('close')} style={roundBtn}>
          <IconBack size={18} width={2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
        </Press>
        <Txt size={13} weight="600" color={C.textMute}>{t('productDetails')}</Txt>
        <Press onPress={toggleWatch} accessibilityLabel={t('watchPrice')} style={[roundBtn, { backgroundColor: watchId ? 'rgba(62,224,154,.15)' : C.fill }]}>
          <IconBookmark size={18} fill={watchId ? C.green : 'none'} color={watchId ? C.green : C.text} />
        </Press>
      </Row>

      {!product ? <Spinner /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View style={{ height: 300, borderRadius: 32, overflow: 'hidden', backgroundColor: '#111419', borderWidth: 1, borderColor: C.line, justifyContent: 'flex-end' }}>
            <LinearGradient colors={['rgba(62,224,154,.38)', 'transparent']} start={{ x: 0.5, y: 0.25 }} end={{ x: 0.5, y: 0.8 }} style={{ position: 'absolute', inset: 0 }} />
            <LinearGradient colors={['transparent', 'rgba(139,92,246,.34)']} start={{ x: 0.3, y: 0.6 }} end={{ x: 0.9, y: 1 }} style={{ position: 'absolute', inset: 0 }} />
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ProductThumb uri={product.imageUrl} category={product.category} size={product.imageUrl ? 220 : 150} radius={28} />
            </View>
            <Row style={{ justifyContent: 'space-between', padding: 14 }}>
              <View />
              {product.gtins.length ? (
                <View style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 9, backgroundColor: C.glass }}>
                  <Txt size={11} weight="600" color={C.green}>{t('confirmedMatch')}</Txt>
                </View>
              ) : null}
            </Row>
          </View>

          <View style={{ gap: 6 }}>
            <Txt size={12} color={C.textMute} ltr>{[product.brand, product.model].filter(Boolean).join(' · ')}{product.gtins[0] ? `  ·  EAN ${displayGtin(product.gtins[0])}` : ''}</Txt>
            <Txt size={27} weight="800" display style={{ lineHeight: 33 }}>{L(product.nameAr ?? product.name, product.name)}</Txt>
            <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {product.specs.map((s) => (
                <View key={s.key} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.glass, borderWidth: 1, borderColor: C.line }}>
                  <Txt size={12} color={C.textSoft}>{s.value}</Txt>
                </View>
              ))}
            </Row>
            {product.specSource ? <Txt size={11} color={C.textDim}>{`${t('specSource')}: ${product.specSource.label}`}</Txt> : null}
          </View>

          {hasWebPrices ? (
            <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12 }}>
              <Txt size={12} color={C.amberText} lh={1.6}>{t('webBanner')}</Txt>
            </View>
          ) : null}

          {isDemo ? (
            <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12 }}>
              <Txt size={12} color={C.amberText} lh={1.6}>{t('demoBanner')}</Txt>
            </View>
          ) : null}

          {valueTop ? (
            <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.16)' }}>
              <LinearGradient colors={['rgba(62,224,154,.30)', 'rgba(56,189,248,.22)', 'rgba(139,92,246,.34)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, gap: 12 }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <View style={{ gap: 2 }}>
                    <Txt size={12} color={C.textMute}>{`${t('bestValueNow')} · ${L(valueTop.store.nameAr, valueTop.store.name)}`}</Txt>
                    <Row style={{ gap: 6, alignItems: 'baseline' }}>
                      <Txt size={30} weight="600" color="#fff">{formatAmount(valueTop.finalMinor, cur)}</Txt>
                      <Txt size={13} color={C.textMute}>{`${sym} ${t('sarTotal')}`}</Txt>
                    </Row>
                  </View>
                  {cheapest ? (
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Txt size={11} color={C.textMute}>{t('lowestFinal')}</Txt>
                      <Txt size={15} weight="600" color={C.green}>{`${formatAmount(cheapest.finalMinor, cur)} · ${L(cheapest.store.nameAr, cheapest.store.name)}`}</Txt>
                    </View>
                  ) : null}
                </Row>
                {cheapest && cheapest.id !== valueTop.id ? (
                  <Txt size={12} color="#B8C4D3" lh={1.65} style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.14)', paddingTop: 10 }}>
                    {explain(valueTop, cheapest)}
                  </Txt>
                ) : null}
              </LinearGradient>
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Txt size={22} weight="800" display>{t('offersTitle')}</Txt>
              <Txt size={11.5} color={C.textDim}>{`${offers?.coverage.storeCount ?? 0} ${t('storesMayChange')}`}</Txt>
            </Row>
            <Segmented value={sort} onChange={pickSort} items={[{ k: 'value', label: t('sortValue') }, { k: 'cheapest', label: t('sortCheap') }, { k: 'nearest', label: t('sortNear') }, { k: 'fastest', label: t('sortFast') }]} />
            <Txt size={12} color={C.textMute} lh={1.6}>{sort === 'nearest' && !loc ? t('whyNearNoLoc') : t(SORT_WHY[sort])}</Txt>
            {offers && offers.offers.length === 0 ? <Txt color={C.textMute}>{t('noOffers')}</Txt> : null}
            {offers?.offers.map((o, i) => renderOffer(o, i === 0))}
            {offers?.sponsored.map((s) => (
              <Press key={s.id} onPress={() => WebBrowser.openBrowserAsync(s.clickUrl).catch(() => {})}>
                <Row style={{ borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.18)', padding: 12, paddingHorizontal: 14, gap: 12 }}>
                  <View style={{ paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.07)' }}><Txt size={10} weight="700" color={C.textMute}>{t('ad')}</Txt></View>
                  <Txt size={12.5} color={C.textSoft} style={{ flex: 1 }}>{L(s.labelAr, s.label)}</Txt>
                  {s.priceMinor ? <Txt size={14} weight="600">{formatAmount(s.priceMinor, s.currency)}</Txt> : null}
                </Row>
              </Press>
            ))}
          </View>

          <Glass style={{ borderRadius: 20, padding: 16, gap: 10 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Txt size={15} weight="600">{t('history')}</Txt>
              {history && history.stats.points ? <Txt size={11.5} color={C.textDim}>{`${t('lastDays')} ${history.stats.coverageDays} ${t('days')} · ${history.sourceCount} ${t('sources')}`}</Txt> : null}
            </Row>
            {chart ? (
              <>
                <Svg viewBox="0 0 320 96" style={{ width: '100%', height: 96 }}>
                  <SvgLine x1="0" y1={chart.lowY} x2="320" y2={chart.lowY} stroke={C.green} strokeDasharray="3 4" strokeWidth={1} />
                  <Polygon points={chart.area} fill={C.green} opacity={0.08} />
                  <Polyline points={chart.line} fill="none" stroke={C.text} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <Circle cx={chart.lastX} cy={chart.lastY} r={4.5} fill={C.green} stroke="#fff" strokeWidth={2} />
                </Svg>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt size={12} color={C.textMute}>{t('high')} <Txt size={12} weight="600">{formatAmount(history!.stats.highMinor!, cur)}</Txt></Txt>
                  <Txt size={12} color={C.textMute}>{t('low')} <Txt size={12} weight="600" color={C.green}>{formatAmount(history!.stats.lowMinor!, cur)}</Txt></Txt>
                  <Txt size={12} color={C.textMute}>{t('now')} <Txt size={12} weight="600">{formatAmount(history!.stats.currentMinor!, cur)}</Txt></Txt>
                </Row>
                <Txt size={11.5} color={C.textDim} lh={1.6}>{historyNote(history!)}</Txt>
              </>
            ) : <Txt size={12} color={C.textDim}>{t('noHistory')}</Txt>}
          </Glass>

          {watchId && target !== null ? (
            <View style={{ backgroundColor: 'rgba(62,224,154,.12)', borderRadius: 20, padding: 14, paddingHorizontal: 16, gap: 10 }}>
              <Txt size={13.5} weight="600" color={C.greenSoft}>{t('notifyAt')}</Txt>
              <Row style={{ justifyContent: 'space-between' }}>
                <Press onPress={() => changeTarget(5000)} style={stepBtn}><Txt center size={18}>+</Txt></Press>
                <Txt size={30} weight="700">{formatAmount(target, cur)} <Txt size={13} color={C.textMute} weight="500">{sym}</Txt></Txt>
                <Press onPress={() => changeTarget(-5000)} style={stepBtn}><Txt center size={18}>−</Txt></Press>
              </Row>
            </View>
          ) : null}
        </ScrollView>
      )}

      {product ? (
        <Row style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 12) + 8, backgroundColor: C.glass, borderTopWidth: 1, borderTopColor: C.line, gap: 10 }}>
          <Press onPress={toggleWatch} style={{ flex: 1, height: 50, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' }}>
            <Txt center size={14} weight="600">{watchId ? t('watching') : t('watchPrice')}</Txt>
          </Press>
          <Press onPress={async () => { router.navigate('/assistant'); await startProductChat({ id: product.id, name: product.name }); }} style={{ flex: 1.4, height: 50, borderRadius: 15, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Sparkle size={16} />
            <Txt size={14} weight="600" color={C.ink2}>{t('askAboutIt')}</Txt>
          </Press>
        </Row>
      ) : null}
    </View>
    </Screen>
  );

  function renderOffer(o: OfferDTO, top: boolean) {
    const local = o.channel === 'local';
    const stock = o.stock === 'in_stock' ? (local ? t('inBranch') : t('inStock')) : o.stock === 'limited' ? t('limited') : o.stock === 'out_of_stock' ? t('outOfStock') : t('stockUnknown');
    const eta = o.etaHours === null ? '' : local && o.etaHours <= 6 ? t('pickupToday') : o.etaHours <= 30 ? t('deliveryTomorrow') : `${t('deliveryIn')} ${Math.ceil(o.etaHours / 24)}${lang === 'ar' ? ' أيام' : ' days'}`;
    const meta = [local && o.branch ? L(o.branch.nameAr, o.branch.name) : null, o.branch?.distanceKm != null ? `${o.branch.distanceKm} ${lang === 'ar' ? 'كم' : 'km'}` : null, eta || null].filter(Boolean).join(' · ');
    const conf = { high: [t('confHigh'), C.greenDeep], medium: [t('confMedium'), C.warn], low: [t('confLow'), C.red], stale: [t('confStale'), C.red] }[o.confidence];
    const ship = o.shippingMinor === null ? t('shipUnknown') : o.shippingMinor > 0 ? `${formatAmount(o.priceMinor, o.currency)} + ${t('shipping')} ${formatAmount(o.shippingMinor, o.currency)}` : t('freeShip');
    return (
      <Glass key={o.id} style={{ borderRadius: 18, borderWidth: 1.5, borderColor: top ? C.green : C.line, padding: 14, gap: 10 }}>
        <Row style={{ gap: 12 }}>
          <StoreMark store={o.store} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Row style={{ gap: 6 }}>
              <Txt size={14} weight="600">{L(o.store.nameAr, o.store.name)}</Txt>
              <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 7, backgroundColor: local ? 'rgba(90,140,255,.16)' : 'rgba(170,120,255,.16)' }}>
                <Txt size={10.5} weight="600" color={local ? '#A9C4FF' : '#D0B8FF'}>{local ? t('local') : t('online')}</Txt>
              </View>
            </Row>
            {meta ? <Txt size={12} color={C.textMute} numberOfLines={1}>{meta}</Txt> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 1 }}>
            <Txt size={17} weight="600">{`${o.finalIsEstimate ? '≥ ' : ''}${formatAmount(o.finalMinor, o.currency)}`}</Txt>
            <Txt size={11} color={C.textDim}>{ship}</Txt>
          </View>
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: 6, columnGap: 12 }}>
          <Txt size={11.5} color={C.textMute}>{stock}</Txt>
          <Txt size={11.5} color={C.textMute}>·</Txt>
          <Txt size={11.5} color={C.textMute}>{o.warrantyMonths !== null ? (lang === 'ar' ? `${t('warrantyMonths')} ${o.warrantyMonths} شهر` : `${o.warrantyMonths}-month ${t('warrantyMonths')}`) : t('noWarrantyInfo')}</Txt>
          {o.returnDays !== null ? <><Txt size={11.5} color={C.textMute}>·</Txt><Txt size={11.5} color={C.textMute}>{lang === 'ar' ? `${t('returns')} ${o.returnDays} يوم` : `${o.returnDays}-day ${t('returns')}`}</Txt></> : null}
        </Row>
        <Row style={{ justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: C.lineFaint, paddingTop: 10 }}>
          <Row style={{ gap: 6, flex: 1 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: conf[1] }} />
            <Txt size={11} color={C.textDim} numberOfLines={1} style={{ flexShrink: 1 }}>{`${ago(lang, o.observedAt)} ${t('reliability')} ${conf[0]}${o.isDemo ? ' · ' + t('demoData') : ''}${o.sourceType === 'web_search' ? ' · ' + t('webPrice') : ''}`}</Txt>
          </Row>
          <Press onPress={() => bought(o)} style={{ paddingHorizontal: 6 }}><Txt size={11} color={C.textMute}>{t('markBought')}</Txt></Press>
          {(local && o.branch) || o.buyUrl ? (
            <Press onPress={() => buy(o)}>
              {top ? (
                <LinearGradient colors={[...CTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 32, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' }}>
                  <Txt size={12} weight="600" color={C.ink}>{local ? t('directions') : t('buy')}</Txt>
                </LinearGradient>
              ) : (
                <View style={{ height: 32, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: C.fill2 }}>
                  <Txt size={12} weight="600">{local ? t('directions') : t('buy')}</Txt>
                </View>
              )}
            </Press>
          ) : null}
        </Row>
      </Glass>
    );
  }

  function explain(best: OfferDTO, low: OfferDTO): string {
    const diff = formatAmount(best.finalMinor - low.finalMinor, cur);
    const bn = L(best.store.nameAr, best.store.name);
    const ln = L(low.store.nameAr, low.store.name);
    const perks: string[] = [];
    if ((best.warrantyMonths ?? 0) > (low.warrantyMonths ?? 0)) perks.push(L(`ضمان ${best.warrantyMonths} شهر`, `${best.warrantyMonths}-month warranty`));
    if (best.etaHours !== null && (low.etaHours === null || best.etaHours < low.etaHours)) perks.push(best.channel === 'local' ? L('استلام اليوم', 'same-day pickup') : L('توصيل أسرع', 'faster delivery'));
    if (best.confidence === 'high' && low.confidence !== 'high') perks.push(L('سعر محدث وموثوق', 'a fresher, more reliable price'));
    return L(`${ln} أرخص بـ${diff} ${sym}، لكن ${bn} يوفّر ${perks.join(' و') || 'قيمة أفضل إجمالًا'}.`, `${ln} is ${diff} ${sym} cheaper, but ${bn} offers ${perks.join(' and ') || 'better overall value'}.`);
  }

  function historyNote(h: HistoryResponse): string {
    const first = h.stats.firstAt ? new Date(h.stats.firstAt).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { month: 'long', year: 'numeric' }) : '';
    const adv = {
      buy_now: L('السعر الحالي قريب من أدنى سعر سجلناه.', 'The current price is near the lowest we’ve recorded.'),
      fair: L('السعر الحالي في منتصف النطاق المسجل.', 'The current price is mid-range for the recorded period.'),
      consider_waiting: L('السعر الحالي أعلى من معظم الفترة المسجلة.', 'The current price is higher than most of the recorded period.'),
      insufficient_data: L('البيانات غير كافية لتقدير التوقيت.', 'Not enough data to estimate timing.'),
    }[h.advice];
    return `${adv} ${L(`لا تتوفر بيانات قبل ${first}.`, `No data before ${first}.`)}`;
  }
}

function buildChart(h: HistoryResponse) {
  if (h.points.length < 2 || h.stats.lowMinor === null || h.stats.highMinor === null) return null;
  const W = 320, H = 96;
  const min = h.stats.lowMinor * 0.97, max = h.stats.highMinor * 1.02;
  const pts = h.points.map((p, i) => [Math.round((i * W) / (h.points.length - 1)), Math.round(8 + ((max - p.minor) / (max - min)) * (H - 16))] as const);
  const line = pts.map((p) => p.join(',')).join(' ');
  const lowY = Math.round(8 + ((max - h.stats.lowMinor) / (max - min)) * (H - 16));
  const last = pts[pts.length - 1]!;
  return { line, area: `0,${H} ${line} ${W},${H}`, lowY, lastX: last[0], lastY: last[1] };
}

const roundBtn = { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.glass, alignItems: 'center' as const, justifyContent: 'center' as const };
const stepBtn = { width: 38, height: 38, borderRadius: 12, backgroundColor: C.glass, alignItems: 'center' as const, justifyContent: 'center' as const };
