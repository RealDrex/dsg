import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Share, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MARKETS, currencySymbol, type SortMode } from '@bestprice/core';
import { api } from '../../lib/api';
import { INTERESTS, PRIORITIES } from '../../lib/i18n';
import { useApp } from '../../lib/store';
import { avatarGlow, Chip, Glass, Halo, Hero, Memoji, Press, Row, Segmented, Toggle, Txt, Screen } from '../../ui/kit';
import { AVATARS, C } from '../../ui/theme';

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={12} weight="600" color={C.textMute}>{title}</Txt>
        {right}
      </Row>
      <Glass style={{ borderRadius: 18 }}>{children}</Glass>
    </View>
  );
}

function Line({ label, value, valueColor, onPress, last }: { label: string; value?: React.ReactNode; valueColor?: string; onPress?: () => void; last?: boolean }) {
  return (
    <Press onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.lineFaint, gap: 10 }}>
      <Txt size={14} style={{ flexShrink: 1 }}>{label}</Txt>
      {typeof value === 'string' ? <Txt size={13} color={valueColor ?? C.textMute} weight={valueColor ? '600' : '400'}>{value}</Txt> : value}
    </Press>
  );
}

export default function Profile() {
  const { t, L, lang, user, updateUser, setLang, showToast, bump } = useApp();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.name ?? '');
  const [prefs, setPrefs] = useState<{ id: string; text: string }[]>([]);
  const [newPref, setNewPref] = useState('');
  const [gender, setGender] = useState<'m' | 'f'>(user?.avatar.startsWith('f') ? 'f' : 'm');
  const [locGranted, setLocGranted] = useState<boolean | null>(null);

  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  const loadPrefs = useCallback(async () => { if (!user?.id) return; try { setPrefs(await api.preferences()); } catch { /* offline */ } }, [user?.id]);
  useFocusEffect(useCallback(() => {
    void loadPrefs();
    Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => setLocGranted(null));
  }, [loadPrefs]));
  if (!user) return null;

  const confirm = (msg: string, onYes: () => void) => {
    if (Platform.OS === 'web') { if (globalThis.confirm?.(msg)) onYes(); return; }
    Alert.alert('', msg, [{ text: t('cancel'), style: 'cancel' }, { text: t('confirm'), style: 'destructive', onPress: onYes }]);
  };

  const toggleInterest = (ar: string) => updateUser({ interests: user.interests.includes(ar) ? user.interests.filter((x) => x !== ar) : [...user.interests, ar] });

  return (
    <Screen>
    <ScrollView contentContainerStyle={{ paddingBottom: 130, gap: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Hero radius={38} height={180} style={{ paddingTop: insets.top + 14, paddingHorizontal: 24, paddingBottom: 28, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Memoji name={user.avatar} size={88} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size={26} weight="800" color={C.ink} display>{user.name || t('guest')}</Txt>
          <Txt size={12.5} weight="600" color="rgba(6,33,15,.72)">{user.plan === 'pro' ? t('proPlan') : t('freePlan')}</Txt>
        </View>
        {user.plan === 'free' ? (
          <View style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.ink, justifyContent: 'center' }}>
            <Txt size={12.5} weight="700" color={C.green}>{t('upgrade')}</Txt>
          </View>
        ) : null}
      </Hero>

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        <Section title={t('yourProfile')}>
          <View style={{ padding: 14, paddingHorizontal: 16, gap: 14 }}>
            <View style={{ gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={12} color={C.textDim}>{t('pickAvatar')}</Txt>
                <Segmented light value={gender} onChange={setGender} items={[{ k: 'm', label: t('male') }, { k: 'f', label: t('female') }]} />
              </Row>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 4 }}>
                {AVATARS[gender].map((a) => {
                  const on = user.avatar === a;
                  return (
                    <Press key={a} onPress={() => updateUser({ avatar: a })} accessibilityLabel={a} accessibilityState={{ selected: on }}
                      style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, borderColor: on ? C.green : 'transparent', alignItems: 'center', justifyContent: 'center', transform: [{ scale: on ? 1.06 : 1 }] }}>
                      <Halo color={avatarGlow(a)} size={42} />
                      <Memoji name={a} size={40} />
                    </Press>
                  );
                })}
              </ScrollView>
            </View>
            <View style={{ gap: 6 }}>
              <Txt size={12} color={C.textDim}>{t('name')}</Txt>
              <TextInput value={name} onChangeText={setName} onEndEditing={() => name.trim() !== (user.name ?? '') && updateUser({ name: name.trim() })} placeholder={t('namePh')} placeholderTextColor={C.textDim} maxLength={60}
                style={{ height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.fill, paddingHorizontal: 12, fontSize: 14, color: C.text, textAlign: lang === 'ar' ? 'right' : 'left' }} />
            </View>
            <View style={{ gap: 8 }}>
              <Txt size={12} color={C.textDim}>{t('interests')}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {INTERESTS.map(([ar, en]) => <Chip key={ar} label={L(ar, en)} selected={user.interests.includes(ar)} onPress={() => toggleInterest(ar)} />)}
              </Row>
            </View>
            <View style={{ gap: 8 }}>
              <Txt size={12} color={C.textDim}>{t('priority')}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {PRIORITIES.map((p) => <Chip key={p.k} label={L(p.ar, p.en)} selected={user.priority === p.k} onPress={() => updateUser({ priority: p.k as SortMode })} />)}
              </Row>
            </View>
          </View>
        </Section>

        <View style={{ gap: 8 }}>
          <Section title={t('regionLang')}>
            <View style={{ paddingVertical: 12, paddingHorizontal: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: C.lineFaint }}>
              <Txt size={14}>{t('countryCurrency')}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {MARKETS.map((m) => <Chip key={m.code} label={`${L(m.nameAr, m.nameEn)} · ${currencySymbol(m.currency, lang)}`} selected={user.country === m.code} onPress={() => { void updateUser({ country: m.code }); bump(); }} />)}
              </Row>
            </View>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16 }}>
              <Txt size={14}>{t('language')}</Txt>
              <Segmented light value={lang} onChange={setLang} items={[{ k: 'ar', label: 'العربية' }, { k: 'en', label: 'English' }]} />
            </Row>
          </Section>
          <Txt size={11.5} color={C.textDim} lh={1.6} style={{ paddingHorizontal: 4 }}>{t('countryNote')}</Txt>
        </View>

        <Section title={t('memoryTitle')} right={<Toggle label={t('mem')} on={user.memoryEnabled} onChange={(v) => { void updateUser({ memoryEnabled: v }); if (!v) setPrefs([]); }} />}>
          {user.memoryEnabled ? (
            <>
              {prefs.map((p) => (
                <Row key={p.id} style={{ justifyContent: 'space-between', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.lineFaint }}>
                  <Txt size={13.5} style={{ flex: 1 }}>{p.text}</Txt>
                  <Press onPress={async () => { await api.removePreference(p.id).catch(() => {}); void loadPrefs(); }} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 9, backgroundColor: 'rgba(255,255,255,.05)' }}>
                    <Txt size={12} color={C.textMute}>{t('delete')}</Txt>
                  </Press>
                </Row>
              ))}
              {prefs.length === 0 ? <Txt size={13} color={C.textDim} style={{ padding: 14, paddingHorizontal: 16 }}>{t('noPrefs')}</Txt> : null}
              <TextInput value={newPref} onChangeText={setNewPref} placeholder={t('addPref')} placeholderTextColor={C.textDim} maxLength={200} returnKeyType="done"
                onSubmitEditing={async () => { const v = newPref.trim(); if (!v) return; setNewPref(''); await api.addPreference(v).catch(() => {}); void loadPrefs(); }}
                style={{ paddingVertical: 12, paddingHorizontal: 16, fontSize: 13.5, color: C.text, textAlign: lang === 'ar' ? 'right' : 'left' }} />
            </>
          ) : <Txt size={13} color={C.textDim} style={{ padding: 14, paddingHorizontal: 16 }}>{t('memoryOffNote')}</Txt>}
        </Section>

        <Section title={t('privacy')}>
          <Line label={t('location')} value={locGranted ? t('locWhileUsing') : t('locOff')} onPress={async () => { const r = await Location.requestForegroundPermissionsAsync().catch(() => null); setLocGranted(!!r?.granted); }} />
          <Line label={t('searchHistory')} value={t('clear')} valueColor={C.coral} onPress={() => confirm(t('searchHistory') + ' — ' + t('clear') + '?', async () => { await api.clearHistory().catch(() => {}); showToast({ title: t('cleared') }); bump(); })} />
          <Line label={t('notifications')} value={t('notifDrops')} />
          <Line label={t('exportData')} value="JSON" onPress={async () => { const d = await api.exportData().catch(() => null); if (d) await Share.share({ message: JSON.stringify(d, null, 2) }).catch(() => {}); }} />
          <Line last label={t('deleteAccount')} value="" valueColor={C.red} onPress={() => confirm(t('deleteConfirm'), async () => { await api.deleteAccount().catch(() => {}); await api.boot({ lang }); bump(); })} />
        </Section>

        <Section title={t('account')}>
          {user.kind === 'guest' ? (
            <View style={{ padding: 14, paddingHorizontal: 16, gap: 10 }}>
              <Txt size={12.5} color={C.textSoft} lh={1.6}>{t('guestNote')}</Txt>
              <Row style={{ gap: 8 }}>
                <Press onPress={() => router.push({ pathname: '/auth', params: { mode: 'register' } })} style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt center size={13.5} weight="700" color={C.ink}>{t('createAccount')}</Txt>
                </Press>
                <Press onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } })} style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', alignItems: 'center', justifyContent: 'center' }}>
                  <Txt center size={13.5} weight="600">{t('signIn')}</Txt>
                </Press>
              </Row>
            </View>
          ) : (
            <>
              <Line label={t('email')} value={user.email ?? ''} />
              <Line last label={t('signOut')} value="" onPress={async () => { await api.logout().catch(() => {}); bump(); }} />
            </>
          )}
        </Section>

        <Txt center size={11.5} color={C.textDim} lh={1.7}>{t('fairness')}</Txt>
        <View style={{ alignItems: 'center', gap: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
          <Txt center size={11.5} color={C.textMute}>{t('version')}</Txt>
          <Txt center size={11.5} color={C.textDim}>{t('credit')}</Txt>
        </View>
      </View>
    </ScrollView>
    </Screen>
  );
}
