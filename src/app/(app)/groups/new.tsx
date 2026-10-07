/**
 * New group: a name and the friends in it. A group chat is created with it.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, TextField } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Row } from '@/components/ui/primitives';
import { useAppMutation, useFriendships } from '@/hooks/data';
import { qk } from '@/lib/query';
import { createSplitGroup } from '@/services/friends';
import { spacing } from '@/theme/tokens';

const IDEAS = ['Goa trip', 'Flatmates', 'Office lunch', 'Family', 'Weekend trip'];

export default function NewGroup() {
  const friendships = useFriendships();
  const friends = (friendships.data ?? []).filter((f) => f.status === 'accepted');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const create = useAppMutation(() => createSplitGroup(name.trim(), members), {
    context: 'groups.create',
    invalidate: [qk.splitGroups, qk.conversations],
    success: 'Group created',
    onSuccess: (id) => router.replace({ pathname: '/groups/[id]', params: { id } }),
  });

  return (
    <Screen
      footer={
        <Button
          title="Create group"
          disabled={!name.trim() || members.length === 0}
          loading={create.isPending}
          onPress={() => create.mutate(undefined)}
        />
      }
    >
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Goa trip"
        maxLength={60}
        autoFocus
      />
      <Row gap={spacing.sm} wrap style={{ marginTop: spacing.md, marginBottom: spacing.xl }}>
        {IDEAS.map((i) => (
          <Chip key={i} label={i} selected={name === i} onPress={() => setName(i)} />
        ))}
      </Row>
      <Section title="Who’s in?">
        {friends.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="people-outline"
              title="Add friends first"
              message="Groups are made of your BUD friends."
            />
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {friends.map((f) => (
              <Chip
                key={f.other.id}
                label={f.other.name}
                selected={members.includes(f.other.id)}
                onPress={() =>
                  setMembers((m) =>
                    m.includes(f.other.id) ? m.filter((x) => x !== f.other.id) : [...m, f.other.id],
                  )
                }
              />
            ))}
          </View>
        )}
      </Section>
    </Screen>
  );
}
