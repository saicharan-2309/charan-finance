/**
 * Auto-categorise rules: "anything that mentions SWIGGY is Food › Food
 * Delivery". The app ships with rules for the merchants most people in India
 * pay; add your own for the local shop, your landlord, your gym.
 *
 * A merchant you have corrected by hand always wins over a rule; among rules,
 * the longest matching words win ("swiggy instamart" beats "swiggy").
 */
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Button, SegmentedControl, TextField } from '@/components/ui/controls';
import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { SelectField, SelectSheet } from '@/components/ui/pickers';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { categoryLabel, categoryOptions, splitCategoryValue } from '@/features/shared/options';
import { useAppMutation, useCategoryIndex, useRules } from '@/hooks/data';
import { qk } from '@/lib/query';
import { createRule, deleteRule } from '@/services/bank-sync';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { CategoryKind, CategoryRule } from '@/types/domain';

export default function RulesScreen() {
  const { colors } = useTheme();
  const q = useRules();
  const { index } = useCategoryIndex();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);

  const add = useAppMutation(createRule, {
    context: 'rules.create',
    invalidate: [qk.rules],
    success: 'Rule added. New bank transactions will use it.',
    onSuccess: () => {
      setPattern('');
      setCategory(null);
    },
  });
  const remove = useAppMutation(deleteRule, { context: 'rules.delete', invalidate: [qk.rules] });

  const options = useMemo(() => categoryOptions(index, kind), [index, kind]);
  const valid = pattern.trim().length >= 2 && !!category;

  return (
    <Screen>
      <Section title="Add a rule">
        <Card style={{ gap: spacing.md }}>
          <SegmentedControl
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCategory(null);
            }}
            options={[
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
            ]}
          />
          <TextField
            label="When the merchant or payee mentions"
            value={pattern}
            onChangeText={setPattern}
            placeholder="e.g. sharma stores"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <SelectField
            label="File it under"
            value={category ? categoryLabel(index, ...splitPair(category)) : null}
            icon={category ? index.byId.get(splitCategoryValue(category).categoryId)?.icon : null}
            color={category ? index.byId.get(splitCategoryValue(category).categoryId)?.color : null}
            placeholder="Choose a category"
            onPress={() => setPicker(true)}
          />
          <SelectSheet
            visible={picker}
            title="Category"
            searchable
            options={options}
            selected={category}
            onSelect={(v) => {
              setCategory(v);
              setPicker(false);
            }}
            onClose={() => setPicker(false)}
          />
          <Button
            title="Add rule"
            disabled={!valid}
            loading={add.isPending}
            onPress={() => {
              const { categoryId, subcategoryId } = splitCategoryValue(category!);
              add.mutate({ pattern, kind, categoryId, subcategoryId });
            }}
          />
        </Card>
      </Section>

      <QueryState query={q}>
        {(rules) => {
          const term = search.trim().toLowerCase();
          const shown = rules.filter(
            (r) =>
              !term ||
              r.pattern.includes(term) ||
              categoryLabel(index, r.categoryId, r.subcategoryId).toLowerCase().includes(term),
          );
          const groups = groupByCategory(shown, index);
          return (
            <Section title={`Your rules (${rules.length})`}>
              <TextField
                value={search}
                onChangeText={setSearch}
                placeholder="Search rules"
                leading={<Icon name="search" size={18} tone="tertiary" />}
                autoCapitalize="none"
              />
              <View style={{ height: spacing.md }} />
              {groups.length === 0 ? (
                <EmptyState
                  compact
                  icon="git-branch-outline"
                  title="No rules match"
                  message="Try another word."
                />
              ) : (
                <View style={{ gap: spacing.md }}>
                  {groups.map((g) => (
                    <Card key={g.key} style={{ gap: spacing.sm }}>
                      <Row gap={spacing.md}>
                        <CategoryAvatar icon={g.icon} color={g.color} size={34} />
                        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                          {g.label}
                        </Text>
                      </Row>
                      <Divider />
                      <Row wrap gap={spacing.sm}>
                        {g.rules.map((r) => (
                          <Pressable
                            key={r.id}
                            onPress={() =>
                              Alert.alert(
                                `Delete “${r.pattern}”?`,
                                'Transactions already filed stay as they are.',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => remove.mutate(r.id),
                                  },
                                ],
                              )
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Rule ${r.pattern}. Delete`}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              paddingLeft: spacing.md,
                              paddingRight: spacing.sm,
                              height: 30,
                              borderRadius: 15,
                              backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                              borderWidth: 1,
                              borderColor: colors.border,
                            })}
                          >
                            <Text variant="footnote">{r.pattern}</Text>
                            <Icon name="close" size={14} tone="tertiary" />
                          </Pressable>
                        ))}
                      </Row>
                    </Card>
                  ))}
                </View>
              )}
            </Section>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function splitPair(value: string): [string, string | null] {
  const { categoryId, subcategoryId } = splitCategoryValue(value);
  return [categoryId, subcategoryId];
}

function groupByCategory(
  rules: CategoryRule[],
  index: ReturnType<typeof useCategoryIndex>['index'],
): { key: string; label: string; icon: string | null; color: string | null; rules: CategoryRule[] }[] {
  const map = new Map<string, CategoryRule[]>();
  for (const r of rules) {
    const k = `${r.categoryId}:${r.subcategoryId ?? ''}`;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const first = list[0];
      const cat = index.byId.get(first.subcategoryId ?? first.categoryId) ?? index.byId.get(first.categoryId);
      return {
        key,
        label: categoryLabel(index, first.categoryId, first.subcategoryId),
        icon: cat?.icon ?? null,
        color: cat?.color ?? null,
        rules: list,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
