// Pip on the phone: the same drawing as the web and desktop (shared pipStaticSvg), with a slow float, an occasional
// blink and a hop when celebrating. Still when the phone asks for reduced motion.
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PIP_LABELS, pipStaticSvg, type Mood } from '../../../packages/companion/src/index.js';

export function Pip({ mood, size = 96, dark = false }: { mood: Mood; size?: number; dark?: boolean }) {
  const [still, setStill] = useState(false);
  const [blink, setBlink] = useState(false);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (still || mood === 'sleepy') { y.setValue(0); return; }
    const hop = mood === 'celebrate';
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: hop ? -12 : -3, duration: hop ? 380 : 1900, easing: hop ? Easing.out(Easing.quad) : Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: hop ? 420 : 1900, easing: hop ? Easing.bounce : Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]), { iterations: hop ? 3 : -1 });
    loop.start();
    return () => loop.stop();
  }, [mood, still, y]);
  useEffect(() => {
    if (still || !['idle', 'in', 'waking'].includes(mood)) return;
    const timer = setInterval(() => { setBlink(true); setTimeout(() => setBlink(false), 140); }, 5200);
    return () => clearInterval(timer);
  }, [mood, still]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={PIP_LABELS[mood]} style={{ width: size, height: size }}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <SvgXml xml={pipStaticSvg({ mood, theme: dark ? 'dark' : 'light', size, blink })} width={size} height={size} />
      </Animated.View>
    </View>
  );
}
