/**
 * Selection UI: a native page-sheet picker with search, and date/time fields.
 */
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatShortDate, formatTime } from '@/lib/dates';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, radius, spacing } from '@/theme/tokens';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Divider, Icon, Text } from './primitives';
import { TextField } from './controls';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  subtitle?: string;
  icon?: string | null;
  color?: string | null;
  /** Indents the row (subcategories). */
  depth?: number;
}

export function SelectSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  searchable,
  noneLabel,
  footerAction,
  addAction,
}: {
  visible: boolean;
  title: string;
  options: SelectOption<T>[];
  selected?: T | null;
  onSelect: (value: T | null) => void;
  onClose: () => void;
  searchable?: boolean;
  /** Adds a "none" row that selects null. */
  noneLabel?: string;
  footerAction?: { label: string; onPress: (query: string) => void };
  /**
   * An always-visible action at the end of the list — used to create the thing
   * being picked ("Add new payment method") without leaving the flow.
   */
  addAction?: { label: string; icon?: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.subtitle?.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: GUTTER,
            paddingTop: spacing.xl,
            paddingBottom: spacing.md,
          }}
        >
          <Text variant="title">{title}</Text>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text variant="bodyStrong" tone="brand">
              Done
            </Text>
          </Pressable>
        </View>
        {searchable ? (
          <View style={{ paddingHorizontal: GUTTER, paddingBottom: spacing.sm }}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              autoCorrect={false}
              clearButtonMode="while-editing"
              leading={<Icon name="search" size={18} tone="tertiary" />}
              returnKeyType="search"
            />
          </View>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + spacing.xl }}
          ItemSeparatorComponent={() => <Divider inset={52} />}
          ListHeaderComponent={
            noneLabel ? (
              <OptionRow
                label={noneLabel}
                selected={selected == null}
                onPress={() => {
                  onSelect(null);
                  close();
                }}
              />
            ) : null
          }
          ListFooterComponent={
            <>
              {footerAction &&
              query.trim() &&
              !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) ? (
                <Pressable
                  onPress={() => {
                    footerAction.onPress(query.trim());
                    close();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingVertical: spacing.lg,
                  }}
                  accessibilityRole="button"
                >
                  <Icon name="add-circle" size={24} tone="brand" />
                  <Text variant="bodyStrong" tone="brand">
                    {footerAction.label} “{query.trim()}”
                  </Text>
                </Pressable>
              ) : null}
              {addAction ? (
                <Pressable
                  onPress={() => {
                    close();
                    addAction.onPress();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingVertical: spacing.lg,
                    marginTop: spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                  accessibilityRole="button"
                >
                  <Icon name={addAction.icon ?? 'add-circle-outline'} size={24} tone="brand" />
                  <Text variant="bodyStrong" tone="brand">
                    {addAction.label}
                  </Text>
                </Pressable>
              ) : null}
            </>
          }
          ListEmptyComponent={
            !footerAction ? (
              <Text tone="secondary" style={{ paddingVertical: spacing.xl }} align="center">
                Nothing found
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <OptionRow
              label={item.label}
              subtitle={item.subtitle}
              icon={item.icon}
              color={item.color}
              depth={item.depth}
              selected={item.value === selected}
              onPress={() => {
                onSelect(item.value);
                close();
              }}
            />
          )}
        />
      </View>
    </Modal>
  );
}

function OptionRow({
  label,
  subtitle,
  icon,
  color,
  depth = 0,
  selected,
  onPress,
}: {
  label: string;
  subtitle?: string;
  icon?: string | null;
  color?: string | null;
  depth?: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingLeft: depth * 28,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {icon !== undefined ? (
        <CategoryAvatar icon={icon} color={color} size={depth ? 30 : 38} active={selected} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant={depth ? 'callout' : 'body'}>{label}</Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="checkmark" size={20} tone="brand" /> : null}
    </Pressable>
  );
}

/** A tappable field row that opens a SelectSheet. */
export function SelectField({
  label,
  value,
  placeholder,
  icon,
  color,
  onPress,
  error,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  icon?: string | null;
  color?: string | null;
  onPress: () => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="subhead" tone="secondary">
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          borderWidth: error ? 1.5 : 0,
          borderColor: colors.negative,
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        })}
      >
        {icon ? <CategoryAvatar icon={icon} color={color} size={30} /> : null}
        <Text variant="body" tone={value ? 'primary' : 'tertiary'} style={{ flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={18} tone="tertiary" />
      </Pressable>
      {error ? (
        <Text variant="footnote" tone="negative">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Date / time field: iOS compact native picker; Android dialog. */
export function DateTimeField({
  label,
  value,
  onChange,
  mode = 'date',
  minimumDate,
  maximumDate,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  mode?: 'date' | 'time';
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const { colors, scheme } = useTheme();
  const handle = (_e: DateTimePickerEvent, d?: Date) => {
    if (d) onChange(d);
  };
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 }}
    >
      <Text variant="body">{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={value}
          mode={mode}
          display="compact"
          onChange={handle}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          themeVariant={scheme}
          accentColor={colors.brand}
        />
      ) : (
        <Pressable
          onPress={() =>
            DateTimePickerAndroid.open({ value, mode, onChange: handle, minimumDate, maximumDate })
          }
          style={{
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceMuted,
          }}
        >
          <Text variant="callout">{mode === 'date' ? formatShortDate(value) : formatTime(value)}</Text>
        </Pressable>
      )}
    </View>
  );
}
