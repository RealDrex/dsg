import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProductSummaryDTO } from '@bestprice/core';
import { api } from '../lib/api';
import { MAX_PHOTO_BASE64, mediaTypeOf, takePendingPhoto, type PhotoQuery } from '../lib/photoSearch';
import { useApp } from '../lib/store';
import { useDiscovery } from '../lib/useDiscovery';
import type { StrKey } from '../lib/i18n';
import { IconBack, IconGallery, IconScan, IconSearch } from '../ui/icons';
import { GhostButton, Glass, Press, Row, Screen, Spinner, Txt } from '../ui/kit';
import { LiveSearchPanel, ProductResult } from '../ui/live';
import { C } from '../ui/theme';

const ERRORS: Record<string, StrKey> = { discovery_daily_limit: 'discoverLimit', discovery_busy: 'discoverBusy' };

export default function Search() {
  const { t, rtl, showToast } = useApp();
  const params = useLocalSearchParams<{ photo?: string }>();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [catalog, setCatalog] = useState<ProductSummaryDTO[] | null>(null);
  const [canDiscover, setCanDiscover] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const live = useDiscovery();
  const seq = useRef(0);
  const autoTried = useRef(new Set<string>());
  const v = q.trim();

  const searchWeb = (text: string) => {
    if (text.length < 2) return;
    autoTried.current.add(text);
    setPhoto(null);
    void live.start(t('liveSearching'), () => api.discover({ q: text }));
  };

  const searchPhoto = (p: PhotoQuery) => {
    setPhoto(p.uri);
    void live.start(t('photoSearching'), () => api.discover({ image: { mediaType: p.mediaType, data: p.data }, ...(p.hint ? { q: p.hint } : {}) }));
  };

  // A photo taken on the camera screen.
  useEffect(() => {
    const p = params.photo ? takePendingPhoto() : null;
    if (p) searchPhoto(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.photo]);

  // Instant catalog matches while typing.
  useEffect(() => {
    const n = ++seq.current;
    if (live.state.phase !== 'idle' && !photo) live.reset(); // a new query makes the previous web results stale
    if (v.length < 2) { setCatalog(null); setLoading(false); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.search(v);
        if (n !== seq.current) return;
        setCatalog(r.results);
        setCanDiscover(r.canDiscover);
      } catch {
        if (n === seq.current) setCatalog([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Nothing in the catalog: search the web once the user stops typing.
  useEffect(() => {
    if (!catalog || catalog.length || loading || !canDiscover || live.state.phase !== 'idle' || v.length < 3 || autoTried.current.has(v)) return;
    const id = setTimeout(() => searchWeb(v), 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, loading, canDiscover, live.state.phase, v]);

  const choosePhoto = () => {
    Alert.alert(t('photoSearch'), t('photoHint'), [
      { text: t('photoCamera'), onPress: () => router.replace('/scan?mode=photo') },
      { text: t('photoLibrary'), onPress: () => void pickFromLibrary() },
      { text: t('close'), style: 'cancel' },
    ]);
  };
  const pickFromLibrary = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4, base64: true, allowsEditing: true, exif: false }).catch(() => null);
    const a = r && !r.canceled ? r.assets[0] : null;
    if (!a?.base64) return;
    if (a.base64.length > MAX_PHOTO_BASE64) { showToast({ title: t('errorGeneric') }); return; }
    searchPhoto({ uri: a.uri, mediaType: mediaTypeOf(a.mimeType), data: a.base64, hint: v.length >= 2 ? v : undefined });
  };

  const s = live.state;
  const webResults = s.phase === 'done' ? s.job.results : [];
  const showCta = canDiscover && v.length >= 2 && s.phase === 'idle';
  const catalogOnly = (catalog ?? []).filter((p) => !webResults.some((w) => w.id === p.id));

  return (
    <Screen>
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      <Row style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
        <Press onPress={() => router.back()} accessibilityLabel={t('close')} style={roundBtn}>
          <IconBack size={18} width={2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
        </Press>
        <Row style={{ flex: 1, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.9)', paddingHorizontal: 12, gap: 8 }}>
          <IconSearch size={18} color={C.ink} width={2} />
          <TextInput autoFocus={!params.photo} value={q} onChangeText={setQ} placeholder={t('searchPh')} placeholderTextColor="#5B6672" returnKeyType="search" maxLength={120}
            onSubmitEditing={() => { if (canDiscover && s.phase !== 'running') searchWeb(v); }}
            style={{ flex: 1, fontSize: 15, color: C.ink2, textAlign: rtl ? 'right' : 'left' }} />
        </Row>
        <Press onPress={choosePhoto} accessibilityLabel={t('photoSearch')} style={roundBtn}>
          <IconGallery size={19} />
        </Press>
        <Press onPress={() => router.replace('/scan')} accessibilityLabel={t('scanTitle')} style={roundBtn}>
          <IconScan size={19} />
        </Press>
      </Row>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}>
        {showCta ? (
          <Press onPress={() => searchWeb(v)}>
            <Glass style={{ borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: 'rgba(62,224,154,.45)' }}>
              <Txt size={22}>🌐</Txt>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={14} weight="700">{`${t('liveSearchCta')} «${v}»`}</Txt>
                <Txt size={11.5} color={C.textMute}>{t('liveSearchTitle')}</Txt>
              </View>
            </Glass>
          </Press>
        ) : null}

        {s.phase === 'running' ? <LiveSearchPanel state={s} photoUri={photo} /> : null}

        {s.phase === 'done' && webResults.length ? (
          <View style={{ gap: 10 }}>
            <Txt size={13} weight="700" color={C.textMute}>{t('liveFound')}</Txt>
            {webResults.map((p) => <ProductResult key={p.id} p={p} big />)}
          </View>
        ) : null}
        {s.phase === 'done' && !webResults.length ? (
          <Txt center color={C.textMute} lh={1.7} style={{ marginTop: 6 }}>{s.job.status === 'unavailable' ? t('onlineNeedsKey') : t('notFoundOnline')}</Txt>
        ) : null}
        {s.phase === 'error' ? (
          <View style={{ alignItems: 'center', gap: 10, marginTop: 6 }}>
            <Txt center color={C.coral} lh={1.6}>{t(ERRORS[s.code] ?? 'errorGeneric')}</Txt>
            {s.code !== 'discovery_daily_limit' && !photo ? <GhostButton label={t('retry')} onPress={() => searchWeb(v)} /> : null}
          </View>
        ) : null}

        {loading && !catalog ? <Spinner /> : null}
        {catalogOnly.length ? (
          <View style={{ gap: 10, marginTop: s.phase === 'idle' ? 0 : 8 }}>
            <Txt size={13} weight="700" color={C.textMute}>{t('inCatalog')}</Txt>
            {catalogOnly.map((p) => <ProductResult key={p.id} p={p} />)}
          </View>
        ) : null}

        {canDiscover === false && v.length >= 2 && catalog && !loading ? (
          <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12, marginTop: 4 }}>
            <Txt size={12} color={C.amberText} lh={1.6}>{t('onlineNeedsKey')}</Txt>
          </View>
        ) : null}

        {v.length < 2 && s.phase === 'idle' ? (
          <Press onPress={choosePhoto}>
            <Glass style={{ borderRadius: 18, padding: 16, gap: 6, alignItems: 'center', marginTop: 10 }}>
              <Txt size={28}>📷</Txt>
              <Txt size={14} weight="700">{t('photoSearch')}</Txt>
              <Txt center size={12.5} color={C.textMute} lh={1.6}>{t('photoHint')}</Txt>
            </Glass>
          </Press>
        ) : null}
      </ScrollView>
    </View>
    </Screen>
  );
}

const roundBtn = { width: 40, height: 40, borderRadius: 20, backgroundColor: C.glass, alignItems: 'center' as const, justifyContent: 'center' as const };
