import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAmount, currencySymbol, getMarket, type HomeResponse } from '@bestprice/core';
import { api } from '../../lib/api';
import { useApp } from '../../lib/store';
import { IconBell, IconCamera, IconHeart, IconScan, IconSearch, IconTag, Sparkle } from '../../ui/icons';
import { avatarGlow, Chevron, Glass, GradientButton, Halo, Hero, Memoji, Press, Row, SectionTitle, StoreMark, Txt, Screen } from '../../ui/kit';
import { C, GLOWS } from '../../ui/theme';

export default function Home() {
  const { t, L, lang, user, dataVersion, newChat, sendChat } = useApp();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HomeResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try { setData(await api.home()); } catch { /* keep last data */ }
  }, [user?.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load, dataVersion]));

  const avatar = user?.avatar ?? 'm01';
  const cur = data?.watching[0]?.product.currency ?? getMarket(user?.country).currency;
  const country = getMarket(user?.country);
  const hour = new Date().getHours();
  const greet = `${hour < 12 ? t('goodMorning') : t('goodEvening')}${user?.name ? (lang === 'ar' ? '، ' : ', ') + user.name : ''}`;
  const saved = data?.savings.monthMinor ?? 0;
  const goal = data?.savings.goalMinor ?? 200000;
  const pct = Math.min(100, Math.round((saved / Math.max(1, goal)) * 100));

  const ask = (text: string) => { newChat(); router.navigate('/assistant'); void sendChat(text); };

  return (
    <Screen>
    <ScrollView
      contentContainerStyle={{ paddingBottom: 130, gap: 22 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.green} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Hero style={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 70, gap: 18 }}>
        <Row style={{ gap: 12 }}>
          <Press onPress={() => router.navigate('/profile')} accessibilityLabel={t('tabProfile')}>
            <Memoji name={avatar} size={52} />
          </Press>
          <View style={{ flex: 1, gap: 1 }}>
            <Txt size={12.5} weight="600" color={C.ink} style={{ opacity: 0.75 }}>{greet}</Txt>
            <Txt size={30} weight="800" color={C.ink} display style={{ lineHeight: 35 }}>{t('homeTitle')}</Txt>
          </View>
          <Press onPress={() => router.navigate('/watch')} accessibilityLabel={t('alerts')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,.4)', alignItems: 'center', justifyContent: 'center' }}>
            <IconBell size={19} color={C.ink} />
            {data?.alerts.length ? <View style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: C.pink, borderWidth: 2, borderColor: '#9BEFD0' }} /> : null}
          </Press>
        </Row>
        <Press onPress={() => router.push('/search')} accessibilityRole="search" style={{ height: 50, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.85)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <IconSearch size={19} color={C.ink} width={2} />
          <Txt size={14} color="#3A4554" style={{ flex: 1 }}>{t('searchPh')}</Txt>
          <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: C.ink, justifyContent: 'center' }}>
            <Txt size={11.5} weight="700" color={C.green}>{`${country.code} · ${currencySymbol(country.currency, lang)}`}</Txt>
          </View>
        </Press>
      </Hero>

      <View style={{ paddingHorizontal: 16, gap: 22, marginTop: -84 }}>
        {/* Savings / welcome card */}
        <View style={{ borderRadius: 28, backgroundColor: C.glassSolid, borderWidth: 1, borderColor: C.lineSoft, padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 18 }, elevation: 10 }}>
          {saved > 0 ? (
            <View style={{ flex: 1, gap: 6 }}>
              <Txt size={12.5} weight="600" color={C.textMute}>{t('savedLbl')}</Txt>
              <Row style={{ gap: 6, alignItems: 'baseline' }}>
                <Txt size={40} weight="700" color={C.green} display style={{ lineHeight: 44 }}>{formatAmount(saved, cur)}</Txt>
                <Txt size={13} weight="600" color={C.textMute}>{currencySymbol(cur, lang)}</Txt>
              </Row>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.1)', overflow: 'hidden', marginTop: 6 }}>
                <LinearGradient colors={[C.green, C.sky]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct}%`, height: '100%', borderRadius: 3 }} />
              </View>
              <Txt size={11.5} color={C.textMute}>{`${pct}% ${t('goalOf')} · ${formatAmount(goal, cur)} ${currencySymbol(cur, lang)} · ${data?.savings.purchases ?? 0} ${t('purchases')}`}</Txt>
            </View>
          ) : (
            <View style={{ flex: 1, gap: 6 }}>
              <Txt size={12.5} weight="700" color={C.green}>{t('welcomeHi')}</Txt>
              <Txt size={22} weight="800" display>{t('welcomeTitle')}</Txt>
              <Txt size={12.5} color="#AEB6C0" lh={1.6}>{t('welcomeSub')}</Txt>
              <GradientButton small label={t('welcomeCta')} onPress={() => router.push('/scan')} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
            </View>
          )}
          <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            <Halo color={avatarGlow(avatar)} size={96} />
            <Memoji name={`${avatar}_${saved > 0 ? 7 : 22}`} size={92} />
          </View>
        </View>

        {/* Stats */}
        <Row style={{ gap: 10, marginTop: -10 }}>
          {[
            [data?.stats.watching ?? 0, C.text, t('statWatching')],
            [data?.stats.targetHit ?? 0, C.green, t('statHit')],
            [data?.stats.dropped ?? 0, C.skyLight, t('statDropped')],
          ].map(([n, color, label]) => (
            <Glass key={String(label)} style={{ flex: 1, padding: 12, gap: 2 }}>
              <Txt size={22} weight="700" color={String(color)}>{String(n)}</Txt>
              <Txt size={11.5} weight="600" color={C.textMute}>{String(label)}</Txt>
            </Glass>
          ))}
        </Row>

        {!data?.coverage.live && data ? (
          <View style={{ backgroundColor: C.amberBg, borderRadius: 14, padding: 12 }}>
            <Txt size={12.5} color={C.amberText} lh={1.7}>{t('coverageNote')}</Txt>
          </View>
        ) : null}

        {/* Quick actions */}
        <View style={{ gap: 12 }}>
          <SectionTitle title={t('startHere')} />
          <Row style={{ gap: 10 }}>
            {[
              { label: t('qBarcode'), Icon: IconScan, color: C.green, bg: 'rgba(62,224,154,.14)', go: () => router.push('/scan') },
              { label: t('qPhoto'), Icon: IconCamera, color: C.skyLight, bg: 'rgba(100,210,255,.14)', go: () => router.push({ pathname: '/scan', params: { mode: 'photo' } }) },
              { label: t('qTag'), Icon: IconTag, color: C.orange, bg: 'rgba(255,159,10,.14)', go: () => router.push({ pathname: '/scan', params: { mode: 'tag' } }) },
              { label: t('qSearch'), Icon: IconSearch, color: C.purple, bg: 'rgba(191,90,242,.16)', go: () => router.push('/search') },
            ].map((q) => (
              <Press key={q.label} onPress={q.go} accessibilityRole="button" style={{ flex: 1 }}>
                <Glass style={{ borderRadius: 20, alignItems: 'center', gap: 8, paddingTop: 14, paddingBottom: 12 }}>
                  <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: q.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <q.Icon size={22} color={q.color} />
                  </View>
                  <Txt center size={12} weight="600">{q.label}</Txt>
                </Glass>
              </Press>
            ))}
          </Row>
        </View>

        {/* Advisor card */}
        <View style={{ borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
          <LinearGradient colors={['rgba(62,224,154,.20)', 'rgba(139,92,246,.26)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, gap: 12 }}>
            <Row style={{ gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.1)', alignItems: 'center', justifyContent: 'center' }}><Sparkle /></View>
              <View style={{ flex: 1 }}>
                <Txt size={15} weight="600">{t('advisor')}</Txt>
                <Txt size={12} color={C.textSoft}>{t('advisorSub')}</Txt>
              </View>
              <Press onPress={() => router.navigate('/assistant')} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.green, justifyContent: 'center' }}>
                <Txt size={12.5} weight="700" color={C.ink}>{t('ask')}</Txt>
              </Press>
            </Row>
            <View style={{ gap: 6 }}>
              {(data?.suggestions ?? []).map((s) => (
                <Press key={s} onPress={() => ask(s)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(6,10,16,.35)' }}>
                  <Txt size={13} color="#E5EAF0" style={{ flex: 1 }}>{s}</Txt>
                  <Chevron />
                </Press>
              ))}
            </View>
          </LinearGradient>
        </View>

        {/* Watching carousel */}
        {data?.watching.length ? (
          <View style={{ gap: 12 }}>
            <SectionTitle title={t('statWatching')} action={t('all')} onAction={() => router.navigate('/watch')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
              {data.watching.map((w, i) => {
                const hit = w.hit;
                const delta = w.currentMinor !== null ? w.startMinor - w.currentMinor : 0;
                return (
                  <Press key={w.id} onPress={() => router.push(`/product/${w.product.id}`)} style={{ width: 210, height: 260, borderRadius: 30, overflow: 'hidden', backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
                    <LinearGradient colors={[GLOWS[i % 4]!, 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200, opacity: 0.6 }} />
                    <Row style={{ position: 'absolute', top: 12, left: 12, right: 12, justifyContent: 'space-between' }}>
                      <Txt size={10} color="rgba(255,255,255,.45)" ltr>{t('productPhoto')}</Txt>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,.35)', alignItems: 'center', justifyContent: 'center' }}><IconHeart size={16} color="#fff" width={2} /></View>
                    </Row>
                    <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: 12, borderRadius: 22, backgroundColor: 'rgba(20,22,26,.75)', borderWidth: 1, borderColor: 'rgba(255,255,255,.12)', gap: 4 }}>
                      <Txt size={14} weight="700" numberOfLines={2}>{w.product.name}</Txt>
                      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Txt size={19} weight="800">{w.currentMinor !== null ? formatAmount(w.currentMinor, w.product.currency) : '—'}</Txt>
                        <Txt size={11.5} weight="700" color={hit ? C.green : C.textMute}>{hit ? t('targetHit') : delta > 0 ? `−${formatAmount(delta, w.product.currency)}` : ''}</Txt>
                      </Row>
                    </View>
                  </Press>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Nearby verified deals */}
        {data?.localDeals.length ? (
          <View style={{ gap: 12 }}>
            <SectionTitle title={t('nearbyDeals')} />
            <Row style={{ gap: 10, alignItems: 'stretch' }}>
              {data.localDeals.map((d) => (
                <Press key={d.offer.id} onPress={() => router.push(`/product/${d.product.id}`)} style={{ flex: 1 }}>
                  <Glass style={{ borderRadius: 20, padding: 12, gap: 10, flex: 1 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <StoreMark name={L(d.offer.store.nameAr, d.offer.store.name)} color={d.offer.store.brandColor} size={34} />
                      <Txt size={15} weight="700">{formatAmount(d.offer.finalMinor, d.offer.currency)}</Txt>
                    </Row>
                    <View style={{ gap: 2 }}>
                      <Txt size={13} weight="600" numberOfLines={2}>{d.product.name}</Txt>
                      <Txt size={11} color={C.textMute} lh={1.5}>{`${L(d.offer.store.nameAr, d.offer.store.name)} ${d.offer.branch ? '· ' + L(d.offer.branch.nameAr, d.offer.branch.name) : ''}${d.offer.isDemo ? ' · ' + t('demoData') : ''}`}</Txt>
                    </View>
                  </Glass>
                </Press>
              ))}
            </Row>
          </View>
        ) : null}

        {/* Recent */}
        {data?.recent.length ? (
          <View style={{ gap: 12 }}>
            <SectionTitle title={t('recent')} />
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {data.recent.map((p) => (
                <Press key={p.id} onPress={() => router.push(`/product/${p.id}`)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.fill, borderWidth: 1, borderColor: C.lineSoft }}>
                  <Txt size={12.5}>{p.name}</Txt>
                </Press>
              ))}
            </Row>
          </View>
        ) : null}
      </View>
    </ScrollView>
    </Screen>
  );
}
