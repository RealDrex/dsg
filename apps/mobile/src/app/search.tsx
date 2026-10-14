import React, { useEffect, useRef, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatAmount, currencySymbol, type ProductSummaryDTO } from '@bestprice/core';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { IconBack, IconScan, IconSearch } from '../ui/icons';
import { Chevron, Glass, PhotoPlaceholder, Press, Row, Spinner, Txt, Screen } from '../ui/kit';
import { C } from '../ui/theme';

export default function Search() {
  const { t, lang, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductSummaryDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) { setResults(null); return; }
    const n = ++seq.current;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.search(v);
        if (n === seq.current) setResults(r.results);
      } catch {
        if (n === seq.current) setResults([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

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
        ListEmptyComponent={results && !loading ? <Txt center color={C.textMute} style={{ marginTop: 30 }}>{t('noResults')}</Txt> : null}
        renderItem={({ item: p }) => (
          <Press onPress={() => router.push(`/product/${p.id}`)}>
            <Glass style={{ borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <PhotoPlaceholder size={52} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt size={14} weight="600" numberOfLines={2}>{p.name}</Txt>
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
