/**
 * A person's avatar: initials on a BUD-swatch gradient. The swatch is picked
 * from the name, so the same friend always has the same colour. Groups show
 * a people glyph instead of initials. No photos are uploaded or stored.
 */
import { View } from 'react-native';

import { GradientFill } from '@/components/ui/gradient';
import { Icon, Text } from '@/components/ui/primitives';
import { useTheme } from '@/theme/ThemeProvider';
import { BUD_SWATCHES } from '@/theme/tokens';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}

function swatchFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BUD_SWATCHES[h % BUD_SWATCHES.length]!;
}

export function Avatar({ name, size = 40, group = false }: { name: string; size?: number; group?: boolean }) {
  const { colors } = useTheme();
  const s = swatchFor(name || '?');
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: group ? size * 0.3 : size / 2,
        borderCurve: 'continuous',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <GradientFill colors={[s.base, s.deep]} sheen />
      {group ? (
        <Icon name="people" size={size * 0.48} color={colors.heroText} />
      ) : (
        <Text
          style={{ color: colors.heroText, fontSize: size * 0.38, fontWeight: '700', letterSpacing: 0.3 }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
