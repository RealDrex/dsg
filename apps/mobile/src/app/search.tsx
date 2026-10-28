import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shopCategory, SHOP_CATEGORIES, type ProductSummaryDTO, type ShopCategory } from '@bestprice/core';
import { api } from '../lib/api';
import { MAX_PHOTO_BASE64, mediaTypeOf, takePendingPhoto, type PhotoQuery } from '../lib/photoSearch';
import { useApp } from '../lib/store';
import { useDiscovery } from '../lib/useDiscovery';
import type { StrKey } from '../lib/i18n';
import { IconBack, IconCamera, IconClose, IconGallery, IconGlobe, IconScan, IconSearch } from '../ui/icons';
import { CategoryTile, GhostButton, Glass, Press, Row, Screen, Spinner, SuggestChip, Txt } from '../ui/kit';
import { LiveSearchPanel, ProductResult } from '../ui/live';
import { C } from '../ui/theme';

const ERRORS: Record<string, StrKey> = { discovery_daily_limit: 'discoverLimit', discovery_busy: 'discoverBusy' };
const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) || /^(www\.|vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com)\S*$/i.test(s.trim());
const asUrl = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`);

/**
 * One box for everything: type a product, paste a TikTok or store link, or
 * pick a category. Catalog matches show instantly; the web search shows its
 * real progress, then each product with its best option.
 */
export default function Search() {
  const { t, L, lang, rtl, showToast } = useApp();
  const params = useLocalSearchParams<{ photo?: string; cat?: string }>();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ShopCategory | null>(shopCategory(params.cat));
  const [catalog, setCatalog] = useState<ProductSummaryDTO[] | null>(null);
  const [catProducts, setCatProducts] = useState<ProductSummaryDTO[] | null>(null);
  const [canDiscover, setCanDiscover] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const live = useDiscovery();
  const seq = useRef(0);
  const autoTried = useRef(new Set<string>());
  const v = q.trim();
  const link = isLink(v);

  const [covers, setCovers] = useState<Record<string, string | null>>({});
  useEffect(() => {
    api.canDiscover().then(setCanDiscover).catch(() => setCanDiscover(false));
    api.categories().then((list) => setCovers(Object.fromEntries(list.map((c) => [c.id, c.imageUrl])))).catch(() => {});
  }, []);
  useEffect(() => {
    setCatProducts(null);
    if (cat) api.categoryProducts(cat.id).then(setCatProducts).catch(() => setCatProducts([]));
  }, [cat]);

  const searchWeb = (text: string) => {
    if (text.length < 2) return;
    autoTried.current.add(text);
    setPhoto(null);
    if (isLink(text)) void live.start(t('linkSearching'), () => api.discover({ url: asUrl(text) }));
    else void live.start(t('liveSearching'), () => api.discover({ q: text, ...(cat ? { category: cat.id } : {}) }));
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

  // Instant catalog matches while typing (not for links).
  useEffect(() => {
    const n = ++seq.current;
    if (live.state.phase !== 'idle' && !photo) live.reset(); // a new query makes the previous web results stale
    if (v.length < 2 || link) { setCatalog(null); setLoading(false); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.search(v);
        if (n !== seq.current) return;
        setCatalog(r.results);
        setCanDiscover(r.canDiscover);
        // The server looks up missing photos in the background: pick them up a moment later.
        if (r.results.some((p) => !p.imageUrl)) {
          setTimeout(() => {
            if (n !== seq.current) return;
            api.search(v).then((again) => { if (n === seq.current) setCatalog(again.results); }).catch(() => {});
          }, 4000);
        }
      } catch {
        if (n === seq.current) setCatalog([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // A pasted link searches right away; a name with no catalog match searches once typing stops.
  useEffect(() => {
    if (!canDiscover || live.state.phase !== 'idle' || autoTried.current.has(v)) return;
    if (link) { const id = setTimeout(() => searchWeb(v), 400); return () => clearTimeout(id); }
    if (!catalog || catalog.length || loading || v.length < 3) return;
    const id = setTimeout(() => searchWeb(v), 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, loading, canDiscover, live.state.phase, v, link]);

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
    searchPhoto({ uri: a.uri, mediaType: mediaTypeOf(a.mimeType), data: a.base64, hint: v.length >= 2 && !link ? v : undefined });
  };

  const pickIdea = (idea: string) => { setQ(idea); autoTried.current.add(idea); setTimeout(() => searchWeb(idea), 0); };

  const s = live.state;
  const webResults = s.phase === 'done' ? s.job.results : [];
  const showCta = canDiscover && v.length >= 2 && s.phase === 'idle';
  const catalogOnly = (catalog ?? []).filter((p) => !webResults.some((w) => w.id === p.id));
  const empty = v.length < 2 && s.phase === 'idle';

  return (
    <Screen>
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      <Row style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}>
        <Press onPress={() => router.back()} accessibilityLabel={t('close')} style={roundBtn}>
          <IconBack size={18} width={2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
        </Press>
        <Row style={{ flex: 1, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.9)', paddingHorizontal: 12, gap: 8 }}>
          <IconSearch size={18} color={C.ink} width={2} />
          <TextInput autoFocus={!params.photo && !params.cat} value={q} onChangeText={setQ} placeholder={t('searchPh2')} placeholderTextColor="#5B6672"
            returnKeyType="search" maxLength={link ? 2048 : 120} autoCapitalize="none" autoCorrect={!link}
            onSubmitEditing={() => { if (canDiscover && s.phase !== 'running') searchWeb(v); }}
            style={{ flex: 1, minWidth: 0, fontSize: 15, color: C.ink2, textAlign: rtl && !link ? 'right' : 'left' }} />
        </Row>
        <Press onPress={choosePhoto} accessibilityLabel={t('photoSearch')} style={roundBtn}><IconGallery size={19} /></Press>
        <Press onPress={() => router.replace('/scan')} accessibilityLabel={t('scanTitle')} style={roundBtn}><IconScan size={19} /></Press>
      </Row>

      {/* Category: a chip to clear it, then ideas to tap. */}
      {cat ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
          <Row style={{ gap: 8 }}>
            <Press onPress={() => setCat(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(62,224,154,.16)', borderWidth: 1, borderColor: 'rgba(62,224,154,.4)' }}>
              <Txt size={13} weight="700" color={C.greenSoft}>{L(cat.ar, cat.en)}</Txt>
              <IconClose size={13} color={C.textMute} width={2} />
            </Press>
          </Row>
          {empty ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(lang === 'ar' ? cat.ideasAr : cat.ideasEn).map((idea) => <SuggestChip key={idea} label={idea} onPress={() => pickIdea(idea)} />)}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}>
        {showCta ? (
          <Press onPress={() => searchWeb(v)}>
            <Glass style={{ borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: 'rgba(62,224,154,.45)' }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(62,224,154,.14)', alignItems: 'center', justifyContent: 'center' }}>
                <IconGlobe size={20} color={C.green} width={1.8} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={14} weight="700" numberOfLines={2}>{link ? t('linkCta') : `${t('liveSearchCta')} «${v}»`}</Txt>
                <Txt size={11.5} color={C.textMute}>{cat ? L(cat.ar, cat.en) : t('liveSearchTitle')}</Txt>
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

        {canDiscover === false && v.length >= 2 ? (
          <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12, marginTop: 4 }}>
            <Txt size={12} color={C.amberText} lh={1.6}>{t('onlineNeedsKey')}</Txt>
          </View>
        ) : null}

        {/* Nothing typed: the category's products, or every category. */}
        {empty && cat ? (
          catProducts === null ? <Spinner /> : catProducts.map((p) => <ProductResult key={p.id} p={p} />)
        ) : null}
        {empty && !cat ? (
          <View style={{ gap: 10 }}>
            <Txt size={13} weight="700" color={C.textMute}>{t('categories')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {SHOP_CATEGORIES.map((c) => (
                <CategoryTile key={c.id} name={L(c.ar, c.en)} imageUrl={covers[c.id] ?? null} width="31%" height={112} onPress={() => setCat(c)} />
              ))}
            </View>
            <Press onPress={choosePhoto}>
              <Glass style={{ borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center', justifyContent: 'center' }}>
                  <IconCamera size={20} color={C.text} width={1.8} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={14} weight="700">{t('photoSearch')}</Txt>
                  <Txt size={12} color={C.textMute} lh={1.5}>{t('photoHint')}</Txt>
                </View>
              </Glass>
            </Press>
          </View>
        ) : null}
      </ScrollView>
    </View>
    </Screen>
  );
}

const roundBtn = { width: 40, height: 40, borderRadius: 20, backgroundColor: C.glass, alignItems: 'center' as const, justifyContent: 'center' as const };
