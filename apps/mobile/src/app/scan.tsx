import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatAmount, currencySymbol, type ScanResponse } from '@bestprice/core';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import type { StrKey } from '../lib/i18n';
import { IconFlash, IconGallery, IconSearch } from '../ui/icons';
import { Glass, GhostButton, GradientButton, PhotoPlaceholder, Press, Row, Txt } from '../ui/kit';
import { C } from '../ui/theme';

type Mode = 'barcode' | 'photo' | 'tag' | 'gallery';
const MODES: { k: Mode; label: StrKey; hint: StrKey }[] = [
  { k: 'barcode', label: 'modeBarcode', hint: 'hintBarcode' },
  { k: 'photo', label: 'modePhoto', hint: 'hintPhoto' },
  { k: 'tag', label: 'modeTag', hint: 'hintTag' },
  { k: 'gallery', label: 'modeGallery', hint: 'hintGallery' },
];

export default function Scan() {
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const { t, lang, startProductChat } = useApp();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(params.mode ?? 'barcode');
  const [perm, requestPerm] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const locked = useRef(false);

  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(line, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(line, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [line]);

  const lookup = async (raw: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const r = await api.scan(raw);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(r);
    } catch {
      setNote(t('offline'));
      locked.current = false;
    } finally {
      setBusy(false);
    }
  };
  const onBarcode = (e: BarcodeScanningResult) => { if (mode === 'barcode' && !result) void lookup(e.data); };
  const rescan = () => { setResult(null); setNote(null); locked.current = false; };

  const capture = async () => {
    if (mode === 'barcode') { setManual(true); return; }
    if (mode === 'gallery') {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 }).catch(() => null);
      if (!r || r.canceled) return;
    }
    // Visual recognition is not in the MVP: be honest and route to name search.
    setNote(t('visualSoon'));
  };

  const frameH = mode === 'barcode' ? 170 : 300;
  const hint = MODES.find((m) => m.k === mode)!.hint;
  const camReady = perm?.granted && Platform.OS !== 'web';

  return (
    <View style={{ flex: 1, backgroundColor: '#06090D', paddingTop: insets.top + 8 }}>
      {camReady ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr', 'itf14'] }}
          onBarcodeScanned={result || busy ? undefined : onBarcode} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#11171E' }]} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,9,13,.35)' }]} pointerEvents="none" />

      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20 }}>
        <Press onPress={() => router.back()} accessibilityLabel={t('close')} style={topBtn}><Txt center size={20} color="#fff">×</Txt></Press>
        <Txt size={14} weight="600" color="#fff">{result ? t('scanned') : t('scanTitle')}</Txt>
        <Press onPress={() => setTorch((x) => !x)} accessibilityLabel="flash" style={[topBtn, torch ? { backgroundColor: 'rgba(62,224,154,.3)' } : null]}><IconFlash size={18} color="#fff" width={1.8} /></Press>
      </Row>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {!perm?.granted && Platform.OS !== 'web' && !result ? (
          <View style={{ padding: 30, gap: 14, alignItems: 'center' }}>
            <Txt center color="#B8C4D3" lh={1.6}>{t('camPermission')}</Txt>
            <GradientButton label={t('allowCamera')} onPress={requestPerm} />
          </View>
        ) : (
          <View style={{ width: 260, height: frameH }}>
            {[{ top: 0, right: 0, bt: 'Top', br: 'Right' }, { top: 0, left: 0, bt: 'Top', br: 'Left' }, { bottom: 0, right: 0, bt: 'Bottom', br: 'Right' }, { bottom: 0, left: 0, bt: 'Bottom', br: 'Left' }].map((c, i) => (
              <View key={i} style={{ position: 'absolute', ...c, width: 34, height: 34, borderColor: C.green, [`border${c.bt}Width`]: 3, [`border${c.br}Width`]: 3, [`border${c.bt}${c.br}Radius`]: 14 } as object} />
            ))}
            {!result ? (
              <Animated.View style={{ position: 'absolute', left: 16, right: 16, height: 2, borderRadius: 2, backgroundColor: C.green, shadowColor: C.green, shadowOpacity: 0.8, shadowRadius: 8, top: 0, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [frameH * 0.08, frameH * 0.88] }) }] }} />
            ) : null}
          </View>
        )}
        {!result ? <Txt center size={12.5} color="#B8C4D3" lh={1.6} style={{ position: 'absolute', bottom: 18, left: 40, right: 40 }}>{Platform.OS === 'web' && mode === 'barcode' ? t('camUnavailable') : t(hint)}</Txt> : null}
      </View>

      {note ? (
        <Glass blur style={{ marginHorizontal: 16, marginBottom: 10, padding: 14, gap: 10, borderRadius: 18 }}>
          <Txt size={13} lh={1.6}>{note}</Txt>
          <GradientButton small label={t('qSearch')} onPress={() => router.replace('/search')} style={{ alignSelf: 'flex-start' }} />
        </Glass>
      ) : null}

      {manual && !result ? (
        <Glass blur style={{ marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 18 }}>
          <Row style={{ gap: 8 }}>
            <TextInput value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))} placeholder={t('enterBarcode')} placeholderTextColor={C.textDim} keyboardType="number-pad" maxLength={14} autoFocus
              onSubmitEditing={() => code.length >= 8 && lookup(code)}
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: C.fill, paddingHorizontal: 12, color: C.text, fontSize: 15, letterSpacing: 1 }} />
            <GradientButton small label={t('lookup')} onPress={() => code.length >= 8 && lookup(code)} loading={busy} />
          </Row>
        </Glass>
      ) : null}

      {!result ? (
        <View style={{ paddingBottom: insets.bottom + 24, alignItems: 'center', gap: 20 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
            {MODES.map((m) => (
              <Press key={m.k} onPress={() => { setMode(m.k); setNote(null); }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: mode === m.k ? '#fff' : 'rgba(255,255,255,.1)' }}>
                <Txt size={12.5} weight="600" color={mode === m.k ? C.ink2 : '#fff'}>{t(m.label)}</Txt>
              </Press>
            ))}
          </ScrollView>
          <Row style={{ gap: 44 }}>
            <Press onPress={() => { setMode('gallery'); void capture(); }} accessibilityLabel={t('modeGallery')} style={sideBtn}><IconGallery size={20} color="#fff" width={1.8} /></Press>
            <Press onPress={capture} accessibilityLabel={t('scanTitle')} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: 'rgba(255,255,255,.35)', padding: 4 }}>
              <View style={{ flex: 1, borderRadius: 34, backgroundColor: C.glass }} />
            </Press>
            <Press onPress={() => router.replace('/search')} accessibilityLabel={t('qSearch')} style={sideBtn}><IconSearch size={20} color="#fff" width={1.8} /></Press>
          </Row>
        </View>
      ) : (
        renderResult(result)
      )}
    </View>
  );

  function renderResult(r: ScanResponse) {
    const box = { marginHorizontal: 10, marginBottom: insets.bottom + 10, padding: 18, borderRadius: 30, gap: 14 };
    if (r.match) {
      const p = r.match.product;
      return (
        <Glass blur style={box}>
          <Row style={{ gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.greenDeep }} />
            <Txt size={12} weight="600" color={C.green}>{t('identified')}</Txt>
          </Row>
          <Row style={{ gap: 12 }}>
            <PhotoPlaceholder size={60} radius={16} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt size={15} weight="600">{p.name}</Txt>
              <Txt size={11.5} color={C.textMute} ltr>{[p.brand, p.model].filter(Boolean).join(' · ')}</Txt>
              {p.bestPriceMinor !== null ? (
                <Txt size={12.5} color={C.textSoft}>{`${t('from')} `}<Txt size={12.5} weight="600">{formatAmount(p.bestPriceMinor, p.currency)}</Txt>{` ${currencySymbol(p.currency, lang)} ${t('atStores')} ${p.offerCount} ${t('storesWord')}`}</Txt>
              ) : <Txt size={12.5} color={C.textMute}>{t('noPrice')}</Txt>}
            </View>
          </Row>
          <Row style={{ gap: 8 }}>
            <GhostButton label={t('askAssistant')} style={{ flex: 1 }} onPress={async () => { router.dismissAll(); router.navigate('/assistant'); await startProductChat(p); }} />
            <GradientButton label={t('comparePrices')} style={{ flex: 1.3 }} onPress={() => router.replace(`/product/${p.id}`)} />
          </Row>
          <Press onPress={() => router.replace('/search')}><Txt center size={12} color={C.textMute}>{t('notThis')}</Txt></Press>
        </Glass>
      );
    }
    if (r.kind === 'url' && r.url) {
      const color = r.url.risk === 'safe' ? C.green : r.url.risk === 'caution' ? C.warn : C.red;
      const msg = r.url.risk === 'safe' ? t('qrSafe') : r.url.risk === 'caution' ? t('qrCaution') : t('qrBlocked');
      return (
        <Glass blur style={box}>
          <Txt size={12} weight="700" color={color}>{t('qrLink')}</Txt>
          <Txt size={13} ltr selectable numberOfLines={3} style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>{r.url.host}</Txt>
          <Txt size={12.5} color={C.textSoft} lh={1.6}>{msg}</Txt>
          <Row style={{ gap: 8 }}>
            <GhostButton label={t('scanAgain')} style={{ flex: 1 }} onPress={rescan} />
            {r.url.risk !== 'blocked' ? <GradientButton label={t('openLink')} style={{ flex: 1 }} onPress={() => WebBrowser.openBrowserAsync(r.url!.url).catch(() => {})} /> : null}
          </Row>
        </Glass>
      );
    }
    return (
      <Glass blur style={box}>
        <Txt size={13.5} lh={1.6}>{r.kind === 'gtin' ? t('notFoundBarcode') : t('qrOther')}</Txt>
        {r.candidates.map((c) => (
          <Press key={c.id} onPress={() => router.replace(`/product/${c.id}`)}><Txt size={13} color={C.greenSoft}>{c.name}</Txt></Press>
        ))}
        <Row style={{ gap: 8 }}>
          <GhostButton label={t('scanAgain')} style={{ flex: 1 }} onPress={rescan} />
          <GradientButton label={t('qSearch')} style={{ flex: 1 }} onPress={() => router.replace('/search')} />
        </Row>
      </Glass>
    );
  }
}

const topBtn = { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center' as const, justifyContent: 'center' as const };
const sideBtn = { width: 46, height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.2)', backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center' as const, justifyContent: 'center' as const };
