import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/store';
import { IconCheck } from './icons';
import { Glass, Row, Txt } from './kit';
import { C, CTA } from './theme';

export function ToastView() {
  const { toast } = useApp();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (toast) { y.setValue(0); Animated.spring(y, { toValue: 1, useNativeDriver: true, friction: 8 }).start(); }
  }, [toast, y]);
  if (!toast) return null;
  return (
    <Animated.View accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 60, opacity: y, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}>
      <Glass blur style={{ borderRadius: 20, borderColor: 'rgba(62,224,154,.35)', padding: 14, backgroundColor: 'rgba(20,24,30,.82)' }}>
        <Row style={{ gap: 12 }}>
          <LinearGradient colors={[...CTA]} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
            <IconCheck size={18} color={C.ink} width={2.6} />
          </LinearGradient>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={14} weight="700">{toast.title}</Txt>
            {toast.sub ? <Txt size={12} color="#AEB6C0">{toast.sub}</Txt> : null}
          </View>
        </Row>
      </Glass>
    </Animated.View>
  );
}
