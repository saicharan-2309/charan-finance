import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Chip, SegmentedControl, TextField } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { ColorPicker, IconPicker } from '@/features/shared/ColorPicker';
import { useAppMutation, useCategoryIndex } from '@/hooks/data';
import { describeError } from '@/lib/errors';
import { qk, queryClient } from '@/lib/query';
import { createCategory, deleteCategory, updateCategory } from '@/services/core';
import { spacing } from '@/theme/tokens';
import type { Category, CategoryKind, SpendClass } from '@/types/domain';

export default function CategoryEditScreen() {
  const { id, kind, parentId } = useLocalSearchParams<{
    id?: string;
    kind?: CategoryKind;
    parentId?: string;
  }>();
  const q = useCategoryIndex();
  if (q.isPending)
    return (
      <Screen>
        <SkeletonList rows={3} />
      </Screen>
    );
  const existing = id ? (q.index.byId.get(id) ?? null) : null;
  const parent =
    (existing?.parentId ?? parentId) ? (q.index.byId.get((existing?.parentId ?? parentId)!) ?? null) : null;
  return (
    <CategoryForm
      existing={existing}
      parent={parent}
      kind={existing?.kind ?? parent?.kind ?? kind ?? 'expense'}
      subs={existing ? (q.index.children.get(existing.id) ?? []) : []}
    />
  );
}

function CategoryForm({
  existing,
  parent,
  kind,
  subs,
}: {
  existing: Category | null;
  parent: Category | null;
  kind: CategoryKind;
  subs: Category[];
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [classification, setClassification] = useState<SpendClass | 'none'>(
    existing?.classification ?? parent?.classification ?? 'none',
  );
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? parent?.icon ?? 'pricetag-outline');
  const [color, setColor] = useState<string | null>(existing?.color ?? parent?.color ?? '#EA580C');
  const [error, setError] = useState<string | null>(null);

  const save = useAppMutation(
    async () => {
      const cls = classification === 'none' ? null : classification;
      if (existing) await updateCategory(existing.id, { name, classification: cls, icon, color });
      else
        await createCategory({ name, kind, parentId: parent?.id ?? null, classification: cls, icon, color });
    },
    {
      invalidate: 'financial',
      success: existing ? 'Category updated' : 'Category added',
      onSuccess: () => router.back(),
      context: 'save-category',
    },
  );

  const submit = () => {
    if (!name.trim()) return setError('Enter a name.');
    setError(null);
    save.mutate(undefined);
  };

  const archive = async (archived: boolean) => {
    if (!existing) return;
    try {
      await updateCategory(existing.id, { isArchived: archived });
      await queryClient.invalidateQueries({ queryKey: qk.categories });
      toast.show(archived ? 'Category archived' : 'Category restored');
      router.back();
    } catch (e) {
      toast.show(describeError(e).message, 'error');
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      'Delete category?',
      'Only possible if no transactions, budgets or recurring items use it. Otherwise, archive it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(existing.id);
              await queryClient.invalidateQueries({ queryKey: qk.categories });
              toast.show('Category deleted');
              router.back();
            } catch (e) {
              const info = describeError(e);
              toast.show(
                info.code === '23503'
                  ? 'This category has history, so it was not deleted. Archive it instead.'
                  : info.message,
                'error',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit category' : parent ? `New subcategory` : 'New category',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <Row gap={spacing.lg} style={{ marginBottom: spacing.xl }}>
        <IconBadge icon={icon} color={color} size={56} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="secondary">
            {parent
              ? `Subcategory of ${parent.name}`
              : kind === 'income'
                ? 'Income category'
                : 'Expense category'}
          </Text>
          <Text variant="headline">{name || 'Name'}</Text>
        </View>
      </Row>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={40}
        error={error}
        autoFocus={!existing}
      />

      {kind === 'expense' && !parent ? (
        <Section title="Spending type" style={{ marginTop: spacing.xxl }}>
          <SegmentedControl<SpendClass | 'none'>
            value={classification}
            onChange={setClassification}
            options={[
              { value: 'essential', label: 'Essential' },
              { value: 'discretionary', label: 'Discretionary' },
              { value: 'none', label: 'Unclassified' },
            ]}
          />
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            Used for the essential vs discretionary report.
          </Text>
        </Section>
      ) : null}

      <Section title="Colour" style={{ marginTop: spacing.xxl }}>
        <ColorPicker value={color} onChange={setColor} />
      </Section>
      <Section title="Icon">
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </Section>

      {existing && !existing.parentId ? (
        <Section title="Subcategories">
          <Card style={{ paddingVertical: spacing.xs }}>
            {subs.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => router.push({ pathname: '/categories/edit', params: { id: s.id } })}
                  style={{ paddingVertical: spacing.md }}
                  accessibilityRole="button"
                >
                  <Text variant="body" tone={s.isArchived ? 'tertiary' : 'primary'}>
                    {s.name}
                    {s.isArchived ? ' (archived)' : ''}
                  </Text>
                </Pressable>
              </View>
            ))}
            {subs.length === 0 ? (
              <Text variant="footnote" tone="secondary" style={{ paddingVertical: spacing.md }}>
                No subcategories yet.
              </Text>
            ) : null}
          </Card>
          <View style={{ marginTop: spacing.md, alignItems: 'flex-start' }}>
            <Chip
              label="+ Add subcategory"
              onPress={() => router.push({ pathname: '/categories/edit', params: { parentId: existing.id } })}
            />
          </View>
        </Section>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Button
          title={existing ? 'Save changes' : 'Add category'}
          onPress={submit}
          loading={save.isPending}
        />
        {existing ? (
          <>
            <Button
              title={existing.isArchived ? 'Restore' : 'Archive'}
              variant="secondary"
              onPress={() => void archive(!existing.isArchived)}
            />
            <Button title="Delete" variant="destructive" onPress={remove} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
