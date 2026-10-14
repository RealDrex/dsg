import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { GradientButton, LogoTile, Press, Txt } from '../ui/kit';
import { C } from '../ui/theme';

const ERR: Record<string, [string, string]> = {
  invalid_credentials: ['البريد أو كلمة المرور غير صحيحة.', 'Email or password is incorrect.'],
  account_locked: ['محاولات كثيرة. حاول بعد 15 دقيقة.', 'Too many attempts. Try again in 15 minutes.'],
  email_taken: ['يوجد حساب بهذا البريد. سجّل الدخول بدلًا من ذلك.', 'An account with this email exists. Sign in instead.'],
  weak_password: ['كلمة المرور ضعيفة. استخدم 10 أحرف على الأقل وتجنب الكلمات الشائعة.', 'Weak password. Use at least 10 characters and avoid common words.'],
  validation_error: ['تأكد من البريد وكلمة المرور.', 'Check your email and password.'],
  rate_limited: ['محاولات كثيرة. انتظر دقيقة.', 'Too many attempts. Wait a minute.'],
};

export default function Auth() {
  const params = useLocalSearchParams<{ mode?: 'login' | 'register' }>();
  const { t, L, rtl, user, bump, showToast } = useApp();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>(params.mode ?? 'register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'register') await api.register(email.trim(), password, user?.name ?? undefined);
      else await api.login(email.trim(), password);
      bump();
      showToast({ title: mode === 'register' ? t('createAccount') : t('signIn'), sub: email.trim() });
      router.back();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      const m = ERR[code];
      setErr(m ? L(m[0], m[1]) : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const input = { height: 50, borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: 'rgba(28,28,30,.9)', paddingHorizontal: 14, fontSize: 15, color: C.text, textAlign: (rtl ? 'right' : 'left') as 'right' | 'left' };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0B0E12' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <LogoTile size={56} />
        <Txt size={28} weight="700" display>{mode === 'register' ? t('createAccount') : t('signIn')}</Txt>
        {mode === 'register' && user?.kind === 'guest' ? <Txt size={13} color={C.textMute} lh={1.6}>{t('guestNote')}</Txt> : null}
        <View style={{ gap: 8 }}>
          <Txt size={13} weight="600" color={C.textMute}>{t('email')}</Txt>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" maxLength={254} style={input} />
        </View>
        <View style={{ gap: 8 }}>
          <Txt size={13} weight="600" color={C.textMute}>{t('password')}</Txt>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} textContentType={mode === 'register' ? 'newPassword' : 'password'} style={input} />
          {mode === 'register' ? <Txt size={11.5} color={C.textDim}>{t('passwordHint')}</Txt> : null}
        </View>
        {err ? <Txt size={13} color={C.coral} lh={1.5}>{err}</Txt> : null}
        <GradientButton label={mode === 'register' ? t('createAccount') : t('signIn')} onPress={submit} loading={busy} disabled={!email || password.length < (mode === 'register' ? 10 : 1)} />
        <Press onPress={() => { setMode(mode === 'register' ? 'login' : 'register'); setErr(null); }}>
          <Txt center size={13} color={C.green} weight="600">{mode === 'register' ? t('haveAccount') : t('noAccount')}</Txt>
        </Press>
        <Press onPress={() => router.back()}><Txt center size={13} color={C.textMute}>{t('cancel')}</Txt></Press>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
