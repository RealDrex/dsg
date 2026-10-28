import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currencySymbol, formatAmount, type CurrencyCode } from '@bestprice/core';
import { ago } from '../lib/i18n';
import { useApp } from '../lib/store';
import { Chip, GradientButton, Press, Row, Txt } from './kit';
import { C } from './theme';

/** A "nice" target: whole 50s above 1,000, 10s above 200, whole units below. */
export function niceTarget(minor: number, unit = 100): number {
  const major = minor / unit;
  const step = major >= 1000 ? 50 : major >= 200 ? 10 : 1;
  return Math.max(step, Math.round(major / step) * step) * unit;
}

/**
 * Sheet to set (or change) the price you want. Shows the current lowest
 * price, quick percentage targets and a custom amount, and says exactly
 * when we'll notify.
 */
export function TargetSheet({ visible, currentMinor, currentIsOld, currency, initialMinor, editing, onSave, onStop, onClose }: {
  visible: boolean;
  currentMinor: number | null;
  /** The price is the last one we know, not a fresh one. */
  currentIsOld?: boolean;
  currency: CurrencyCode;
  initialMinor: number | null;
  editing: boolean;
  onSave: (targetMinor: number) => void;
  onStop?: () => void;
  onClose: () => void;
}) {
  const { t, lang, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const sym = currencySymbol(currency, lang);
  const unit = 100;
  const suggest = currentMinor !== null ? niceTarget(currentMinor * 0.9) : null;
  const [text, setText] = useState('');
  useEffect(() => {
    if (!visible) return;
    const start = initialMinor ?? suggest;
    setText(start !== null ? String(Math.round(start / unit)) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const value = Number(text.replace(/[^\d]/g, ''));
  const targetMinor = Number.isFinite(value) && value > 0 ? value * unit : null;
  const diff = currentMinor !== null && targetMinor !== null ? currentMinor - targetMinor : null;
  const pctOff = diff !== null && currentMinor ? Math.round((diff / currentMinor) * 100) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.55)' }} accessibilityLabel={t('close')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: '#12161B', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.line, padding: 20, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 16 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.18)' }} />
          <Txt size={20} weight="800">{t('targetTitle')}</Txt>

          {currentMinor !== null ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt size={13} color={C.textMute}>{currentIsOld ? t('lastKnownPrice') : t('targetNow')}</Txt>
              <Txt size={18} weight="700">{`${formatAmount(currentMinor, currency)} `}<Txt size={12} color={C.textMute}>{sym}</Txt></Txt>
            </Row>
          ) : null}

          <View style={{ gap: 8 }}>
            <Txt size={13} color={C.textMute}>{t('targetYours')}</Txt>
            <Row style={{ height: 60, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1.5, borderColor: C.green, paddingHorizontal: 16, gap: 8 }}>
              <TextInput value={text} onChangeText={(v) => setText(v.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)))}
                keyboardType="number-pad" maxLength={9} accessibilityLabel={t('targetYours')} selectTextOnFocus
                style={{ flex: 1, minWidth: 0, height: 56, paddingVertical: 0, fontSize: 28, fontWeight: '700', color: C.text, textAlign: rtl ? 'right' : 'left' }} />
              <Txt size={15} color={C.textMute}>{sym}</Txt>
            </Row>
            {currentMinor !== null ? (
              <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                {[5, 10, 15, 20].map((p) => {
                  const v = niceTarget(currentMinor * (1 - p / 100));
                  return <Chip key={p} label={`-${p}٪ · ${formatAmount(v, currency)}`} selected={targetMinor === v} onPress={() => setText(String(v / unit))} />;
                })}
              </Row>
            ) : null}
            {diff !== null && targetMinor !== null ? (
              diff > 0
                ? <Txt size={13} color={C.greenSoft}>{`${t('targetCheaper')} ${formatAmount(diff, currency)} ${sym} (${pctOff}٪)`}</Txt>
                : <Txt size={13} color={C.amberText} lh={1.6}>{t('targetAbove')}</Txt>
            ) : null}
          </View>

          <View style={{ backgroundColor: 'rgba(62,224,154,.08)', borderRadius: 14, padding: 12 }}>
            <Txt size={12.5} color={C.textSoft} lh={1.7}>{t('targetHow')}</Txt>
          </View>

          <GradientButton label={editing ? t('targetSave') : t('targetStart')} disabled={targetMinor === null} onPress={() => targetMinor !== null && onSave(targetMinor)} />
          {editing && onStop ? (
            <Press onPress={onStop} style={{ alignSelf: 'center', padding: 6 }}><Txt size={13} color={C.coral}>{t('targetStop')}</Txt></Press>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Current price vs your target, as a bar that fills as the price comes down. */
export function TargetProgress({ startMinor, currentMinor, targetMinor, currency, lowestMinor, checkedAt, onEdit }: {
  startMinor: number;
  currentMinor: number | null;
  targetMinor: number;
  currency: CurrencyCode;
  lowestMinor?: number | null;
  checkedAt?: string | null;
  onEdit?: () => void;
}) {
  const { t, lang } = useApp();
  const sym = currencySymbol(currency, lang);
  const hit = currentMinor !== null && currentMinor <= targetMinor;
  const span = Math.max(1, startMinor - targetMinor);
  const pct = hit ? 100 : currentMinor === null ? 4 : Math.max(4, Math.min(96, Math.round(((startMinor - currentMinor) / span) * 100)));
  return (
    <View style={{ borderRadius: 20, padding: 16, gap: 12, backgroundColor: hit ? 'rgba(62,224,154,.14)' : 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: hit ? 'rgba(62,224,154,.5)' : C.line }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 2 }}>
          <Txt size={12} color={C.textMute}>{t('now')}</Txt>
          <Txt size={24} weight="800">{currentMinor !== null ? formatAmount(currentMinor, currency) : '—'} <Txt size={12} color={C.textMute}>{sym}</Txt></Txt>
        </View>
        <View style={{ gap: 2, alignItems: 'flex-end' }}>
          <Txt size={12} color={C.textMute}>{t('targetYours')}</Txt>
          <Txt size={24} weight="800" color={C.green}>{formatAmount(targetMinor, currency)} <Txt size={12} color={C.textMute}>{sym}</Txt></Txt>
        </View>
      </Row>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: C.green }} />
      </View>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <Txt size={13} weight="700" color={hit ? C.greenSoft : C.text}>
          {hit ? t('targetReached') : currentMinor !== null ? `${t('targetLeft')}: ${formatAmount(currentMinor - targetMinor, currency)} ${sym}` : t('noPrice')}
        </Txt>
        {lowestMinor != null ? <Txt size={12} color={C.textMute}>{`${t('targetLowest')}: ${formatAmount(lowestMinor, currency)}`}</Txt> : null}
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={11.5} color={C.textDim}>{`${t('lastCheck')}: ${checkedAt ? ago(lang, checkedAt) : t('pricesNever')}`}</Txt>
        {onEdit ? <Press onPress={onEdit} style={{ paddingVertical: 4, paddingHorizontal: 8 }}><Txt size={12.5} weight="600" color={C.green}>{t('targetEdit')}</Txt></Press> : null}
      </Row>
    </View>
  );
}
