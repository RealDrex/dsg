import React, { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MARKETS, type Lang, type SortMode } from '@bestprice/core';
import { INTERESTS, PRIORITIES } from '../lib/i18n';
import { useApp } from '../lib/store';
import { IconBack, IconGlobe } from './icons';
import { avatarGlow, Backdrop, Chip, Halo, LogoTile, Memoji, Press, Row, Segmented, Toggle, Txt } from './kit';
import { AVATARS, C } from './theme';

/** Three-step first-run setup (design 2A): language & country → about you → interests. */
export function Onboarding() {
  const { t, L, lang, rtl, user, setLang, updateUser, finishOnboarding } = useApp();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.name ?? '');
  const [gender, setGender] = useState<'m' | 'f'>(user?.avatar.startsWith('f') ? 'f' : 'm');
  if (!user) return null;

  const titles = [t('st0'), t('st1'), t('st2')];
  const canNext = step !== 1 || name.trim().length > 0;
  const next = () => {
    if (!canNext) return;
    if (step === 1) void updateUser({ name: name.trim() });
    if (step === 2) finishOnboarding();
    else setStep(step + 1);
  };
  const toggleInterest = (ar: string) => updateUser({ interests: user.interests.includes(ar) ? user.interests.filter((x) => x !== ar) : [...user.interests, ar] });

  return (
    <View style={{ position: 'absolute', inset: 0, zIndex: 45, paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: insets.bottom + 20 }}>
      <Backdrop />
      <Row style={{ justifyContent: 'space-between', height: 32 }}>
        <Press onPress={() => setStep(Math.max(0, step - 1))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {step > 0 ? <IconBack size={20} color={C.green} width={2.4} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} /> : null}
          <Txt size={17} weight="600" color={C.green}>{titles[step]}</Txt>
        </Press>
        <Press onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(118,118,128,.24)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt size={12.5} weight="600" color="#fff">{lang === 'ar' ? 'English' : 'العربية'}</Txt>
          <IconGlobe size={14} color="#fff" width={1.8} />
        </Press>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <Txt size={13} color={C.textMute}>{`${step + 1} ${t('stepOf')} 3`}</Txt>
        <Press onPress={finishOnboarding}><Txt size={13} weight="500" color={C.textMute}>{t('skip')}</Txt></Press>
      </Row>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 22, paddingTop: 18, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <>
            <LogoTile size={64} />
            <View style={{ gap: 8 }}>
              <Txt size={32} weight="700" display style={{ lineHeight: 38 }}>{t('welcome')}</Txt>
              <Txt size={14.5} color={C.textMute} lh={1.7}>{t('welcomeSubOb')}</Txt>
            </View>
            <View style={{ gap: 10 }}>
              <Txt size={13} weight="600" color={C.textMute}>{t('language')}</Txt>
              <Row style={{ gap: 8 }}>
                {(['ar', 'en'] as Lang[]).map((k) => (
                  <View key={k} style={{ flex: 1 }}><Chip big label={k === 'ar' ? 'العربية' : 'English'} selected={lang === k} onPress={() => setLang(k)} /></View>
                ))}
              </Row>
            </View>
            <View style={{ gap: 10 }}>
              <Txt size={13} weight="600" color={C.textMute}>{t('country')}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                {MARKETS.map((m) => <Chip big key={m.code} label={L(m.nameAr, m.nameEn)} selected={user.country === m.code} onPress={() => updateUser({ country: m.code })} />)}
              </Row>
              {user.country !== 'SA' ? (
                <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12 }}><Txt size={12.5} color={C.amberText} lh={1.7}>{t('coverageNote')}</Txt></View>
              ) : null}
            </View>
            <Txt size={11.5} color={C.textDim} lh={1.6}>{t('privacyOb')}</Txt>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center' }}>
              <Halo color={avatarGlow(user.avatar)} size={136} />
              <Memoji name={user.avatar} size={92} />
            </View>
            <Txt size={32} weight="700" display>{t('introQ')}</Txt>
            <View style={{ gap: 8 }}>
              <Txt size={15} weight="600">{t('nameQ')}</Txt>
              <TextInput value={name} onChangeText={setName} placeholder={t('namePh')} placeholderTextColor={C.textDim} maxLength={60} autoFocus
                style={{ height: 56, borderRadius: 16, borderWidth: 1.5, borderColor: C.green, backgroundColor: 'rgba(28,28,30,.9)', paddingHorizontal: 16, fontSize: 17, fontWeight: '500', color: '#fff', textAlign: rtl ? 'right' : 'left' }} />
            </View>
            <View style={{ gap: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={15} weight="600">{t('pickAvatar')}</Txt>
                <Segmented light value={gender} onChange={(g) => { setGender(g); void updateUser({ avatar: AVATARS[g][0] }); }} items={[{ k: 'm', label: t('male') }, { k: 'f', label: t('female') }]} />
              </Row>
              <Row style={{ flexWrap: 'wrap', rowGap: 12, justifyContent: 'space-between' }}>
                {AVATARS[gender].map((a) => {
                  const on = user.avatar === a;
                  return (
                    <Press key={a} onPress={() => updateUser({ avatar: a })} accessibilityState={{ selected: on }} style={{ width: '18%', aspectRatio: 1, borderRadius: 999, borderWidth: 2.5, borderColor: on ? C.green : 'transparent', alignItems: 'center', justifyContent: 'center', transform: [{ scale: on ? 1.06 : 1 }] }}>
                      <Memoji name={a} size={54} />
                    </Press>
                  );
                })}
              </Row>
            </View>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View style={{ gap: 8 }}>
              <Txt size={30} weight="700" display>{t('intQ')}</Txt>
              <Txt size={14} color={C.textMute} lh={1.7}>{t('intSub')}</Txt>
            </View>
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {INTERESTS.map(([ar, en]) => <Chip big key={ar} label={L(ar, en)} selected={user.interests.includes(ar)} onPress={() => toggleInterest(ar)} />)}
            </Row>
            <View style={{ gap: 10 }}>
              <Txt size={13} weight="600" color={C.textMute}>{t('priQ')}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                {PRIORITIES.map((p) => {
                  const on = user.priority === p.k;
                  return (
                    <Press key={p.k} onPress={() => updateUser({ priority: p.k as SortMode })} style={{ width: '48.5%', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: on ? C.green : C.lineSoft, backgroundColor: on ? 'rgba(62,224,154,.16)' : C.fill, gap: 3 }}>
                      <Txt size={14} weight="600" color={on ? C.greenSoft : C.text}>{L(p.ar, p.en)}</Txt>
                      <Txt size={11.5} color={on ? C.greenSoft : C.textMute}>{L(p.dar, p.den)}</Txt>
                    </Press>
                  );
                })}
              </Row>
            </View>
            <Row style={{ gap: 12, backgroundColor: C.glass, borderWidth: 1, borderColor: C.lineSoft, borderRadius: 16, padding: 12, paddingHorizontal: 14 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={13.5} weight="600">{t('mem')}</Txt>
                <Txt size={11.5} color={C.textMute}>{t('memSub')}</Txt>
              </View>
              <Toggle on={user.memoryEnabled} onChange={(v) => updateUser({ memoryEnabled: v })} label={t('mem')} />
            </Row>
          </>
        ) : null}
      </ScrollView>

      <Press onPress={next} disabled={!canNext} style={{ height: 54, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: canNext ? 1 : 0.45, marginTop: 14 }}>
        <Txt center size={16} weight="600" color="#000">{step === 2 ? t('start') : t('next')}</Txt>
      </Press>
    </View>
  );
}
