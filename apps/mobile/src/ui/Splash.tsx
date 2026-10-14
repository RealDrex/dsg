import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Backdrop } from './kit';
import { C } from './theme';

/**
 * Animated launch screen from the design: scan corners snap in, a beam
 * sweeps, the green dot pops, then the wordmark and tagline fade in.
 */
export function Splash({ onDone, credit }: { onDone: () => void; credit: string }) {
  const corners = useRef(new Animated.Value(0)).current;
  const beam = useRef(new Animated.Value(0)).current;
  const dot = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tag = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    const anim = Animated.sequence([
      Animated.timing(corners, { toValue: 1, duration: 520, easing: ease, useNativeDriver: true }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(beam, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(beam, { toValue: 2, duration: 120, useNativeDriver: true }),
        ]),
        Animated.spring(dot, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true, delay: 120 }),
      ]),
      Animated.timing(word, { toValue: 1, duration: 420, easing: ease, useNativeDriver: true }),
      Animated.timing(tag, { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(out, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && onDone());
    return () => anim.stop();
  }, [corners, beam, dot, word, tag, out, onDone]);

  const beamY = beam.interpolate({ inputRange: [0, 1, 2], outputRange: [-15, 15, 15] });
  const beamO = beam.interpolate({ inputRange: [0, 0.1, 1, 2], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 50, opacity: out }]}>
      <Pressable style={styles.fill} onPress={onDone} accessibilityLabel="Best Price">
        <Backdrop />
        <View style={styles.center}>
          <View style={{ width: 112, height: 112 }}>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: corners, transform: [{ scale: corners.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) }] }]}>
              <Svg width={112} height={112} viewBox="0 0 48 48">
                <Path d="M5 16v-6a5 5 0 0 1 5-5h6M32 5h6a5 5 0 0 1 5 5v6M43 32v6a5 5 0 0 1-5 5h-6M16 43h-6a5 5 0 0 1-5-5v-6" fill="none" stroke={C.text} strokeWidth={3.6} strokeLinecap="round" />
              </Svg>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: beamO, transform: [{ translateY: Animated.multiply(beamY, 112 / 48) }] }]}>
              <Svg width={112} height={112} viewBox="0 0 48 48"><Rect x="9" y="23" width="30" height="2" rx="1" fill={C.sky} /></Svg>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: dot }] }]}>
              <Svg width={112} height={112} viewBox="0 0 48 48">
                <Circle cx="24" cy="24" r="9.5" fill={C.green} />
                <Circle cx="27.6" cy="20.4" r="2.6" fill="#fff" />
              </Svg>
            </Animated.View>
          </View>
          <Animated.View style={{ opacity: word, transform: [{ translateX: word.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }}>
            <Text style={styles.word}>Best<Text style={{ color: C.green }}>Price</Text></Text>
          </Animated.View>
        </View>
        <Animated.View style={[styles.tag, { opacity: tag }]}>
          <Text style={styles.tagline}>SCAN · ASK · SAVE</Text>
          <Text style={styles.credit}>{credit}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  word: { fontSize: 36, fontWeight: '600', color: C.text, writingDirection: 'ltr' },
  tag: { position: 'absolute', bottom: 44, left: 0, right: 0, alignItems: 'center', gap: 6 },
  tagline: { fontSize: 13, color: C.textMute, letterSpacing: 2, writingDirection: 'ltr' },
  credit: { fontSize: 11, color: C.textDim },
});
