import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAmount, currencySymbol, type AssistantMessageDTO, type RecCardDTO } from '@bestprice/core';
import { useApp } from '../../lib/store';
import { STARTERS } from '../../lib/i18n';
import { IconScan, IconSend } from '../../ui/icons';
import { Badge, Glass, Hero, Memoji, ProductThumb, Press, Row, SuggestChip, Txt, Screen } from '../../ui/kit';
import { C, CTA } from '../../ui/theme';

const MOOD_FACE: Record<AssistantMessageDTO['mood'], number> = { hello: 22, recommending: 7, opinion: 19, done: 10, explaining: 0, neutral: 0 };

export default function Assistant() {
  const { t, L, lang, rtl, user, chat, sendChat, newChat } = useApp();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const avatar = user?.avatar ?? 'm01';

  const welcome: AssistantMessageDTO = useMemo(() => ({
    id: 'welcome', role: 'assistant', mood: 'hello', facts: [], opinion: null, sources: [], recommendations: [], createdAt: '',
    text: L('هلا! أنا مستشار الشراء في Best Price. قل لي وش ناوي تشتري أو وش محتار فيه، وأساعدك توصل لقرار مبني على أسعار فعلية.', 'Hi! I’m the Best Price shopping advisor. Tell me what you’re planning to buy or what you’re unsure about, and I’ll help you decide using real prices.'),
    chips: STARTERS.map(([ar, en]) => L(ar, en)),
  }), [L]);
  const msgs = chat.messages.length ? chat.messages : chat.typing ? [] : [welcome];
  const last = msgs[msgs.length - 1];
  const lastBot = last?.role === 'assistant' ? last : null;

  useEffect(() => {
    const id = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [msgs.length, chat.typing]);

  const face = chat.typing ? `${avatar}_27` : last?.role === 'user' ? `${avatar}_17` : lastBot && MOOD_FACE[lastBot.mood] ? `${avatar}_${MOOD_FACE[lastBot.mood]}` : avatar;
  const thought = chat.typing ? t('thinkCloud') : last?.role === 'user' ? t('hmm') : lastBot?.text ?? '';

  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!chat.typing) { bob.stopAnimation(); bob.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [chat.typing, bob]);

  const send = (text: string) => {
    const v = text.trim();
    if (!v || chat.typing) return;
    setDraft('');
    void sendChat(v);
  };
  const onChip = (label: string) => {
    if (/افتح صفحة المنتج|Open product page/.test(label)) {
      const pid = chat.product?.id ?? [...msgs].reverse().find((m) => m.recommendations.length)?.recommendations[0]?.productId;
      if (pid) return router.push(`/product/${pid}`);
    }
    if (/قائمة المتابعة|Open watchlist/.test(label)) return router.navigate('/watch');
    send(label);
  };

  return (
    <Screen>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      <View style={{ flex: 1, paddingBottom: 96 + Math.max(insets.bottom, 12) }}>
        <Hero radius={30} height={140} style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 18 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt size={22} weight="800" color={C.ink} display>{t('advisor')}</Txt>
              <Txt size={11.5} weight="600" color="rgba(6,33,15,.72)">{chat.typing ? t('aiThinking') : t('aiReady')}</Txt>
            </View>
            <Press onPress={newChat} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,.5)', justifyContent: 'center' }}>
              <Txt size={12.5} weight="700" color={C.ink}>{t('newChat')}</Txt>
            </Press>
          </Row>
        </Hero>

        {chat.product ? (
          <Row style={{ marginHorizontal: 20, marginTop: 10, padding: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(62,224,154,.12)', gap: 10 }}>
            <ProductThumb size={32} radius={9} />
            <Press style={{ flex: 1 }} onPress={() => router.push(`/product/${chat.product!.id}`)}>
              <Txt size={11} weight="600" color={C.green}>{t('chattingAbout')}</Txt>
              <Txt size={13} weight="600" numberOfLines={1}>{chat.product.name}</Txt>
            </Press>
            <Press onPress={newChat} accessibilityLabel={t('close')} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' }}>
              <Txt center size={14} color={C.textSoft}>×</Txt>
            </Press>
          </Row>
        ) : null}

        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 12, gap: 14 }} keyboardShouldPersistTaps="handled">
          {msgs.map((m, i) => {
            const isLastBot = m === lastBot && i === msgs.length - 1;
            if (m.role === 'user') {
              return (
                <View key={m.id} style={{ alignSelf: rtl ? 'flex-start' : 'flex-end', maxWidth: '88%' }}>
                  <LinearGradient colors={[...CTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, borderBottomLeftRadius: 6 }}>
                    <Txt size={14} weight="500" color={C.ink} lh={1.6}>{m.text}</Txt>
                  </LinearGradient>
                </View>
              );
            }
            const showText = !isLastBot && !!m.text;
            const showBox = showText || m.facts.length > 0 || !!m.opinion || m.sources.length > 0;
            return (
              <View key={m.id} style={{ alignSelf: rtl ? 'flex-end' : 'flex-start', width: '97%', gap: 8 }}>
                {showBox ? (
                  <Glass style={{ padding: 12, paddingHorizontal: 14, borderRadius: 18, borderBottomRightRadius: 6, gap: 10 }}>
                    {showText ? <Txt size={14} lh={1.7}>{m.text}</Txt> : null}
                    {m.facts.length ? (
                      <View style={{ gap: 6, padding: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.05)' }}>
                        <Txt size={11} weight="700" color={C.green}>{t('verified')}</Txt>
                        {m.facts.map((f, k) => (
                          <Row key={k} style={{ gap: 8, alignItems: 'flex-start' }}>
                            <Txt size={13} color={C.green}>•</Txt>
                            <Txt size={13} color={C.textSoft} lh={1.6} style={{ flex: 1 }}>{f}</Txt>
                          </Row>
                        ))}
                      </View>
                    ) : null}
                    {m.opinion ? (
                      <View style={{ gap: 4, padding: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.amberBg }}>
                        <Txt size={11} weight="700" color={C.amber}>{t('myTake')}</Txt>
                        <Txt size={13} color={C.amberText} lh={1.65}>{m.opinion}</Txt>
                      </View>
                    ) : null}
                    {m.sources.length ? <Txt size={11} color={C.textDim}>{m.sources.map((s) => s.label).join(' · ')}</Txt> : null}
                  </Glass>
                ) : null}
                {m.recommendations.map((r) => renderRec(r))}
              </View>
            );
          })}
        </ScrollView>

        {/* Advisor stage: memoji + thought cloud + suggested replies */}
        <View style={{ minHeight: 124, paddingHorizontal: 12, paddingTop: 6, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 4 }}>
          <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }, { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['0deg', rtl ? '5deg' : '-5deg'] }) }] }}>
            <Memoji name={face} size={110} />
          </Animated.View>
          <View style={{ flex: 1, minWidth: 0, marginBottom: 10, gap: 4, alignItems: rtl ? 'flex-end' : 'flex-start' }}>
            <View accessibilityLiveRegion="polite" style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 24, backgroundColor: 'rgba(255,255,255,.94)', maxWidth: '100%' }}>
              <Txt size={13.5} weight="600" color={C.ink2} lh={1.55}>{thought}</Txt>
            </View>
            <View style={{ paddingHorizontal: 18, gap: 3 }}>
              <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.9)' }} />
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.8)', marginStart: -8 }} />
            </View>
            {!chat.typing && lastBot?.chips.length ? (
              <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: 4, alignSelf: 'stretch' }}>
                {lastBot.chips.map((c) => <SuggestChip key={c} label={c} onPress={() => onChip(c)} />)}
              </Row>
            ) : null}
          </View>
        </View>

        <Row style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: C.lineSoft, backgroundColor: 'rgba(9,13,18,.55)' }}>
          <Press onPress={() => router.push('/scan')} accessibilityLabel={t('scanTitle')} style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' }}>
            <IconScan size={20} />
          </Press>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => send(draft)}
            placeholder={t('chatPh')}
            placeholderTextColor={C.textDim}
            maxLength={2000}
            returnKeyType="send"
            style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.glass, paddingHorizontal: 14, fontSize: 14, color: C.text, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }}
          />
          <Press onPress={() => send(draft)} accessibilityLabel="send" disabled={chat.typing}>
            <LinearGradient colors={[...CTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: chat.typing ? 0.5 : 1 }}>
              <IconSend size={20} color={C.ink} width={2} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
            </LinearGradient>
          </Press>
        </Row>
      </View>
    </KeyboardAvoidingView>
    </Screen>
  );

  function renderRec(r: RecCardDTO) {
    const tag = r.label === 'best_value' ? { l: t('recBest'), bg: 'rgba(62,224,154,.14)', fg: C.greenSoft } : r.label === 'stretch' ? { l: t('recStretch'), bg: 'rgba(232,163,61,.14)', fg: C.amber } : r.label === 'best_specs' ? { l: t('recSpecs'), bg: 'rgba(56,189,248,.14)', fg: C.skyLight } : { l: t('recCheap'), bg: C.fill2, fg: C.textSoft };
    return (
      <Press key={r.productId} onPress={() => router.push(`/product/${r.productId}`)}>
        <Glass style={{ borderRadius: 18, padding: 12, gap: 10, borderColor: r.label === 'best_value' ? 'rgba(62,224,154,.45)' : C.line }}>
          <Row style={{ gap: 10 }}>
            <ProductThumb size={46} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Badge label={tag.l} bg={tag.bg} fg={tag.fg} />
              <Txt size={13.5} weight="600" numberOfLines={1}>{r.name}</Txt>
              <Txt size={11.5} color={C.textMute} numberOfLines={1}>{r.specLine}</Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt size={15} weight="600">{r.priceMinor !== null ? `${formatAmount(r.priceMinor, r.currency)}` : '—'}</Txt>
              <Txt size={11} color={C.textDim}>{r.storeName ?? currencySymbol(r.currency, lang)}</Txt>
            </View>
          </Row>
          {r.pros.length || r.cons.length ? (
            <Row style={{ gap: 8, alignItems: 'flex-start' }}>
              {r.pros[0] ? <Row style={{ flex: 1, gap: 6, alignItems: 'flex-start' }}><Txt size={12} weight="700" color={C.green}>+</Txt><Txt size={12} color={C.textSoft} style={{ flex: 1 }}>{r.pros[0]}</Txt></Row> : null}
              {r.cons[0] ? <Row style={{ flex: 1, gap: 6, alignItems: 'flex-start' }}><Txt size={12} weight="700" color={C.coral}>−</Txt><Txt size={12} color={C.textSoft} style={{ flex: 1 }}>{r.cons[0]}</Txt></Row> : null}
            </Row>
          ) : null}
          <View style={{ borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: 8 }}>
            <Txt size={12} color={C.textMute} lh={1.6}><Txt size={12} weight="600">{t('whyPicked')} </Txt>{r.why}</Txt>
          </View>
        </Glass>
      </Press>
    );
  }
}
