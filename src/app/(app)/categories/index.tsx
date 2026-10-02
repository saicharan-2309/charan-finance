import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { SegmentedControl } from '@/components/ui/controls';
import { QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, Row, Text } from '@/components/ui/primitives';
import { useCategoryIndex } from '@/hooks/data';
import { spacing } from '@/theme/tokens';
import type { Category, CategoryKind } from '@/types/domain';

export default function CategoriesScreen() {
  const q = useCategoryIndex();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/categories/edit', params: { kind } })}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add category"
            >
              <Text variant="bodyStrong" tone="brand">
                Add
              </Text>
            </Pressable>
          ),
        }}
      />
      <SegmentedControl<CategoryKind>
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
        style={{ marginBottom: spacing.xl }}
      />
      <QueryState query={{ ...q, data: q.data ? q.index : undefined }}>
        {(index) => {
          const top = index.top(kind, true);
          const active = top.filter((c) => !c.isArchived);
          const archived = top.filter((c) => c.isArchived);
          return (
            <>
              <Card style={{ paddingVertical: spacing.xs }}>
                {active.map((c, i) => (
                  <CategoryItem key={c.id} c={c} subs={index.children.get(c.id) ?? []} first={i === 0} />
                ))}
              </Card>
              <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.md }}>
                Categories used by past transactions can’t be deleted — archive them to hide them while
                keeping history intact.
              </Text>
              {archived.length ? (
                <Section style={{ marginTop: spacing.xxl }}>
                  <Pressable onPress={() => setShowArchived((v) => !v)} accessibilityRole="button">
                    <Text variant="subhead" tone="brand">
                      {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
                    </Text>
                  </Pressable>
                  {showArchived ? (
                    <Card style={{ paddingVertical: spacing.xs, marginTop: spacing.md, opacity: 0.7 }}>
                      {archived.map((c, i) => (
                        <CategoryItem key={c.id} c={c} subs={[]} first={i === 0} />
                      ))}
                    </Card>
                  ) : null}
                </Section>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function CategoryItem({ c, subs, first }: { c: Category; subs: Category[]; first: boolean }) {
  const activeSubs = subs.filter((s) => !s.isArchived);
  return (
    <View>
      {!first ? <Divider inset={52} /> : null}
      <Pressable
        onPress={() => router.push({ pathname: '/categories/edit', params: { id: c.id } })}
        accessibilityRole="button"
      >
        <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
          <IconBadge icon={c.icon} color={c.color} size={38} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{c.name}</Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {[
                c.classification === 'essential'
                  ? 'Essential'
                  : c.classification === 'discretionary'
                    ? 'Discretionary'
                    : null,
                activeSubs.length ? activeSubs.map((s) => s.name).join(', ') : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No subcategories'}
            </Text>
          </View>
          <Icon name="chevron-forward" size={16} tone="tertiary" />
        </Row>
      </Pressable>
    </View>
  );
}
