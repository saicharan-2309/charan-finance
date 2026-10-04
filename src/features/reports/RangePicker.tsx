import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Button, Chip } from '@/components/ui/controls';
import { DateTimeField } from '@/components/ui/pickers';
import { Card, Divider, Text } from '@/components/ui/primitives';
import {
  formatShortDate,
  fromISODate,
  RANGE_PRESET_LABELS,
  rangeForPreset,
  toISODate,
  type DateRange,
  type RangePreset,
} from '@/lib/dates';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, spacing } from '@/theme/tokens';

export interface RangeValue {
  preset: RangePreset;
  range: DateRange;
}

export const defaultRange = (startDay = 1): RangeValue => ({
  preset: 'this_month',
  range: rangeForPreset('this_month', new Date(), startDay),
});

const PRESETS: RangePreset[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_year',
  'custom',
];

export function RangePicker({
  value,
  onChange,
  startDay = 1,
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  /** Payday: month presets run payday to payday. */
  startDay?: number;
}) {
  const { colors } = useTheme();
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState(fromISODate(value.range.start));
  const [end, setEnd] = useState(fromISODate(value.range.end));

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -GUTTER }}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: GUTTER }}
      >
        {PRESETS.map((p) => (
          <Chip
            key={p}
            label={
              p === 'custom' && value.preset === 'custom'
                ? `${formatShortDate(value.range.start)} – ${formatShortDate(value.range.end)}`
                : RANGE_PRESET_LABELS[p]
            }
            selected={value.preset === p}
            onPress={() =>
              p === 'custom'
                ? setCustom(true)
                : onChange({ preset: p, range: rangeForPreset(p, new Date(), startDay) })
            }
          />
        ))}
      </ScrollView>
      <Modal visible={custom} transparent animationType="fade" onRequestClose={() => setCustom(false)}>
        <View
          style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay }}
        >
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={() => setCustom(false)}
          />
          <Card style={{ gap: spacing.md, backgroundColor: colors.surfaceElevated }}>
            <Text variant="headline">Custom range</Text>
            <DateTimeField label="From" value={start} onChange={setStart} maximumDate={end} />
            <Divider />
            <DateTimeField label="To" value={end} onChange={setEnd} minimumDate={start} />
            <Button
              title="Apply"
              onPress={() => {
                onChange({ preset: 'custom', range: { start: toISODate(start), end: toISODate(end) } });
                setCustom(false);
              }}
            />
          </Card>
        </View>
      </Modal>
    </View>
  );
}
