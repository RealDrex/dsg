import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatAmount, currencySymbol, type ProductSummaryDTO } from '@bestprice/core';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { IconBack, IconScan, IconSearch } from '../ui/icons';
import { Chevron, Glass, GhostButton, Memoji, ProductThumb, Press, Row, Spinner, Txt, Screen } from '../ui/kit';
import { C } from '../ui/theme';

type Online = { state: 'idle' } | { state: 'searching'; q: string } | { state: 'done'; q: string; found: number } | { state: 'error'; q: string; msg: string };

export default function Search() {
  const { t, L, lang, rtl, user } = useApp();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductSummaryDTO[] | null>(null);
  const [canDiscover, setCanDiscover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<Online>({ state: 'idle' });
  const seq = useRef(0);
  const autoTried = useRef(new Set<string>());

  const runOnline = async (v: string) => {
    const n = seq.current;
    setOnline({ state: 'searching', q: v });
    try {
      const r = await api.discover({ q: v });
      if (n !== seq.current) return;
      if (r.status === 'found') {
        // Catalog results first, then what the store search added (deduplicated).
        setResults((cur) => [...(cur ?? []), ...r.results.filter((p) => !(cur ?? []).some((c) => c.id === p.id))]);
      }
      setOnline({ state: 'done', q: v, found: r.status === 'found' ? r.results.length : 0 });
    } catch (e) {
      if (n !== seq.current) return;
      const msg = e instanceof ApiError && e.status === 429 ? t('discoverLimit') : t('errorGeneric');
      setOnline({ state: 'error', q: v, msg });
    }
  };

  useEffect(() => {
    const v = q.trim();
    const n = ++seq.current;
    setOnline({ state: 'idle' });
    if (v.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.search(v);
        if (n !== seq.current) return;
        setResults(r.results);
        setCanDiscover(r.canDiscover);
      } catch {
        if (n === seq.current) setResults([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  // Nothing in the catalog: look it up in the stores automatically once the user stops typing.
  useEffect(() => {
    const v = q.trim();
    if (!results || results.length || loading || !canDiscover || online.state !== 'idle' || v.length < 3 || autoTried.current.has(v)) return;
    const id = setTimeout(() => { autoTried.current.add(v); void runOnline(v); }, 900);
    return () => clearTimeout(id);
  }, [results, loading, canDiscover, online.state, q]);

  const v = q.trim();
  const emptyCatalog = !!results && results.length === 0 && !loading;

  const footer = () => {
    if (!results || loading) return null;
    if (online.state === 'searching') return <Searching avatar={user?.avatar ?? 'm01'} label={t('searchingOnline')} />;
    if (online.state === 'error') return <Txt center color={C.coral} style={{ marginTop: 18 }}>{online.msg}</Txt>;
    if (online.state === 'done' && online.found === 0) return <Txt center color={C.textMute} lh={1.7} style={{ marginTop: 18 }}>{t('notFoundOnline')}</Txt>;
    if (online.state === 'done') return null;
    if (emptyCatalog && !canDiscover) return <Txt center color={C.textMute} lh={1.7} style={{ marginTop: 30 }}>{t('onlineUnavailable')}</Txt>;
    if (canDiscover && v.length >= 2) {
      return (
        <View style={{ marginTop: 14, gap: 8, alignItems: 'center' }}>
          {results.length ? <Txt size={12.5} color={C.textMute}>{t('notWhatYouWant')}</Txt> : null}
          <GhostButton label={`${t('searchOnline')} · «${v}»`} onPress={() => runOnline(v)} />
        </View>
      );
    }
    return null;
  };

  return (
    <Screen>
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      <Row style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 12 }}>
        <Press onPress={() => router.back()} accessibilityLabel={t('close')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' }}>
          <IconBack size={18} width={2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
        </Press>
        <Row style={{ flex: 1, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.9)', paddingHorizontal: 12, gap: 8 }}>
          <IconSearch size={18} color={C.ink} width={2} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t('searchPh')} placeholderTextColor="#5B6672" returnKeyType="search" maxLength={120}
            onSubmitEditing={() => { if (emptyCatalog && canDiscover && online.state === 'idle' && v.length >= 2) { autoTried.current.add(v); void runOnline(v); } }}
            style={{ flex: 1, fontSize: 15, color: C.ink2, textAlign: rtl ? 'right' : 'left' }} />
        </Row>
        <Press onPress={() => router.replace('/scan')} accessibilityLabel={t('scanTitle')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' }}>
          <IconScan size={19} />
        </Press>
      </Row>
      {loading && !results ? <Spinner /> : null}
      <FlatList
        data={results ?? []}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        ListFooterComponent={footer()}
        renderItem={({ item: p }) => (
          <Press onPress={() => router.push(`/product/${p.id}`)}>
            <Glass style={{ borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ProductThumb uri={p.imageUrl} category={p.category} size={56} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt size={14} weight="600" numberOfLines={2}>{L(p.nameAr ?? p.name, p.name)}</Txt>
                <Txt size={12} color={C.textMute}>{p.offerCount ? `${p.offerCount} ${t('offersCount')}` : t('noPrice')}</Txt>
              </View>
              {p.bestPriceMinor !== null ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt size={11} color={C.textDim}>{t('from')}</Txt>
                  <Txt size={15} weight="700">{formatAmount(p.bestPriceMinor, p.currency)} <Txt size={11} color={C.textMute}>{currencySymbol(p.currency, lang)}</Txt></Txt>
                </View>
              ) : null}
              <Chevron />
            </Glass>
          </Press>
        )}
      />
    </View>
    </Screen>
  );
}

/** Memoji "looking around" while the store search runs (it really is working: this waits on the server). */
function Searching({ avatar, label }: { avatar: string; label: string }) {
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [sway]);
  return (
    <View style={{ alignItems: 'center', marginTop: 24, gap: 10 }}>
      <Animated.View style={{ transform: [{ rotate: sway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }) }] }}>
        <Memoji name={`${avatar}_27`} size={96} />
      </Animated.View>
      <Txt center size={13.5} color={C.textSoft} lh={1.6}>{label}</Txt>
      <Spinner />
    </View>
  );
}
