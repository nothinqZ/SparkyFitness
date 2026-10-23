import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

/** Point on a circle, angle 0 at the left end of the half circle. */
function polar(cx: number, cy: number, r: number, fraction: number) {
  const angle = Math.PI * (1 - fraction);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
}

/**
 * Garmin-style half-circle gauge: a 0-100 value on a grey track, filled in
 * the status colour, with the number in the middle.
 */
const ReadinessGauge: React.FC<{
  value: number;
  colorToken: string;
  label: string;
  size?: number;
}> = ({ value, colorToken, label, size = 132 }) => {
  const [color, track] = useCSSVariable([
    colorToken,
    '--color-progress-track',
  ]) as [string, string];
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const fraction = Math.max(0, Math.min(1, value / 100));
  return (
    <View
      style={{ width: size, height: size / 2 + 8 }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      accessibilityLabel={label}
    >
      <Svg width={size} height={size / 2 + stroke / 2}>
        <Path
          d={arc(cx, cy, r, 0, 1)}
          stroke={track || '#3a3a3c'}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {fraction > 0 ? (
          <Path
            d={arc(cx, cy, r, 0, fraction)}
            stroke={color || '#30d158'}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
      </Svg>
      <View
        className="absolute left-0 right-0 items-center"
        style={{ top: size / 2 - 34 }}
      >
        <Text className="text-text-primary text-3xl font-bold">
          {Math.round(value)}
        </Text>
      </View>
    </View>
  );
};

export default ReadinessGauge;
