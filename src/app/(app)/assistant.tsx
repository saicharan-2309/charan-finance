/**
 * BUD AI — ask about your money in plain words, or ask it to record or fix
 * something.
 *
 *   "What was my food expense last month?"   → read from your transactions
 *   "Change my Amazon transaction from yesterday to Shopping"
 *                                            → a card you confirm, then saved
 *
 * Answers come only from your BUD data (the server's tools read it under your
 * own login); every change is a proposal you confirm, performed by the app's
 * existing functions. Under each answer, "From your data" names what it read.
 */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/BrandMark';
import { haptic } from '@/components/ui/controls';
import { Glass } from '@/components/ui/glass';
import { GradientFill } from '@/components/ui/gradient';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { invalidateFinancialData } from '@/lib/query';
import { useUserId } from '@/providers/AuthProvider';
import { askBudAi, performAction, type ChatTurn, type ProposedAction } from '@/services/assistant';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, continuous, radius, spacing } from '@/theme/tokens';

type ActionState = 'waiting' | 'working' | 'done' | 'cancelled' | 'failed';
interface Item {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  sources?: string[];
  actions?: { action: ProposedAction; state: ActionState; result?: string }[];
}

const SUGGESTIONS = [
  'What did I spend last month?',
  'How much did I spend on food this month?',
  'Where did most of my money go this month?',
  'How much do my friends owe me?',
  'Record ₹500 spent at Starbucks',
];

let seq = 0;
const nextId = () => `m${++seq}`;

export default function AssistantScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useUserId();
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const list = useRef<FlatList<Item>>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    haptic.light();
    setText('');
    const userItem: Item = { id: nextId(), role: 'user', text: q };
    const next = [...items, userItem];
    setItems(next);
    setThinking(true);
    // Only the words go back as history; actions and sources stay on the phone.
    const history: ChatTurn[] = next
      .filter((i) => i.role !== 'notice')
      .map((i) => ({ role: i.role as 'user' | 'assistant', content: i.text }));
    const outcome = await askBudAi(history);
    setThinking(false);
    if (outcome.status === 'ok') {
      setSetup(null);
      setItems((cur) => [
        ...cur,
        {
          id: nextId(),
          role: 'assistant',
          text: outcome.data.reply,
          sources: outcome.data.sources,
          actions: outcome.data.actions.map((action) => ({ action, state: 'waiting' as const })),
        },
      ]);
    } else if (outcome.status === 'not_configured') {
      setSetup(outcome.message);
      setItems((cur) => cur.filter((i) => i.id !== userItem.id));
      setText(q);
    } else {
      haptic.error();
      setItems((cur) => [...cur, { id: nextId(), role: 'notice', text: outcome.message }]);
    }
  };

  const setActionState = (itemId: string, index: number, state: ActionState, result?: string) =>
    setItems((cur) =>
      cur.map((i) =>
        i.id === itemId && i.actions
          ? { ...i, actions: i.actions.map((a, n) => (n === index ? { ...a, state, result } : a)) }
          : i,
      ),
    );

  const confirm = async (itemId: string, index: number, action: ProposedAction) => {
    if (!me) return;
    setActionState(itemId, index, 'working');
    try {
      const result = await performAction(action, me);
      haptic.success();
      setActionState(itemId, index, 'done', result);
      await invalidateFinancialData();
    } catch (e) {
      haptic.error();
      setActionState(itemId, index, 'failed', describeError(e).message);
    }
  };

  const data = [...items].reverse();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {setup ? <SetupCard message={setup} /> : null}
        {items.length === 0 ? (
          <Intro onPick={(s) => void ask(s)} />
        ) : (
          <FlatList
            ref={list}
            inverted
            data={data}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: GUTTER, gap: spacing.md }}
            ListHeaderComponent={thinking ? <Thinking /> : null}
            renderItem={({ item }) =>
              item.role === 'user' ? (
                <UserBubble text={item.text} />
              ) : item.role === 'notice' ? (
                <Text variant="footnote" tone="negative" align="center">
                  {item.text}
                </Text>
              ) : (
                <AnswerCard
                  item={item}
                  onConfirm={(n, a) => void confirm(item.id, n, a)}
                  onCancel={(n) => setActionState(item.id, n, 'cancelled')}
                />
              )
            }
          />
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingHorizontal: GUTTER,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.sm,
          }}
        >
          <Glass style={{ flex: 1, borderRadius: radius.xl, minHeight: 44, justifyContent: 'center' }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Ask BUD AI about your money"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={2000}
              accessibilityLabel="Question for BUD AI"
              onSubmitEditing={() => void ask(text)}
              style={{
                color: colors.text,
                fontSize: 16,
                paddingHorizontal: spacing.lg,
                paddingVertical: 11,
                maxHeight: 120,
              }}
            />
          </Glass>
          <Pressable
            onPress={() => void ask(text)}
            disabled={!text.trim() || thinking}
            accessibilityRole="button"
            accessibilityLabel="Ask"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.fill,
              transform: [{ scale: pressed ? 0.9 : 1 }],
            })}
          >
            {text.trim() && !thinking ? <GradientFill colors={colors.heroGradient} /> : null}
            <Icon
              name="arrow-up"
              size={22}
              color={text.trim() && !thinking ? colors.heroText : colors.textTertiary}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Intro({ onPick }: { onPick: (s: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: GUTTER, justifyContent: 'center', gap: spacing.xl }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <BrandMark size={64} />
        <Text variant="title" align="center">
          Ask BUD AI
        </Text>
        <Text variant="callout" tone="secondary" align="center">
          It answers from your own transactions, accounts and friends — and can record or fix things for you
          to confirm.
        </Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => onPick(s)}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Glass
              style={{ borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
            >
              <Row gap={spacing.sm}>
                <Icon name="sparkles" size={16} color={colors.brand} />
                <Text variant="subhead" style={{ flex: 1 }}>
                  {s}
                </Text>
              </Row>
            </Glass>
          </Pressable>
        ))}
      </View>
      <Text variant="caption" tone="tertiary" align="center">
        Your question and the figures BUD looks up are sent to Anthropic’s Claude to write the answer. Nothing
        changes until you tap Confirm.
      </Text>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth: '82%',
        borderRadius: radius.xl,
        ...continuous,
        borderBottomRightRadius: 6,
        overflow: 'hidden',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <GradientFill colors={colors.heroGradient} />
      <Text variant="callout" style={{ color: colors.heroText }}>
        {text}
      </Text>
    </View>
  );
}

function Thinking() {
  return (
    <Row gap={spacing.sm} style={{ paddingVertical: spacing.sm }}>
      <BrandMark size={24} />
      <Text variant="footnote" tone="secondary">
        Looking at your BUD data…
      </Text>
    </Row>
  );
}

function AnswerCard({
  item,
  onConfirm,
  onCancel,
}: {
  item: Item;
  onConfirm: (index: number, action: ProposedAction) => void;
  onCancel: (index: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '92%', gap: spacing.sm }}>
      <Row gap={spacing.sm} align="flex-start">
        <BrandMark size={26} />
        <Card style={{ flex: 1, gap: spacing.sm, borderTopLeftRadius: 6 }}>
          <Text variant="callout" selectable style={{ lineHeight: 22 }}>
            {item.text}
          </Text>
          {item.sources && item.sources.length > 0 ? (
            <Text variant="caption" tone="tertiary">
              From your data: {item.sources.join(' · ')}
            </Text>
          ) : null}
        </Card>
      </Row>
      {(item.actions ?? []).map(({ action, state, result }, n) => (
        <Card
          key={n}
          style={{ marginLeft: 34, gap: spacing.md, borderWidth: 1, borderColor: colors.brandSoft }}
        >
          <Row gap={spacing.sm} align="flex-start">
            <Icon
              name={
                action.kind === 'split_with_friend'
                  ? 'people'
                  : action.kind === 'update_transaction'
                    ? 'create'
                    : 'add-circle'
              }
              size={20}
              tone="brand"
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subhead" style={{ fontWeight: '700' }}>
                {action.kind === 'split_with_friend'
                  ? 'Split a bill'
                  : action.kind === 'update_transaction'
                    ? 'Change a transaction'
                    : action.type === 'income'
                      ? 'Record money in'
                      : 'Record an expense'}
              </Text>
              <Text variant="footnote" tone="secondary">
                {action.summary}
              </Text>
            </View>
          </Row>
          {state === 'waiting' || state === 'working' ? (
            <Row gap={spacing.sm}>
              <Pressable
                onPress={() => onConfirm(n, action)}
                disabled={state === 'working'}
                accessibilityRole="button"
                accessibilityLabel={`Confirm: ${action.summary}`}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 40,
                  borderRadius: radius.pill,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed || state === 'working' ? 0.7 : 1,
                })}
              >
                <GradientFill colors={colors.heroGradient} />
                <Text variant="subhead" style={{ color: colors.heroText, fontWeight: '700' }}>
                  {state === 'working' ? 'Saving…' : 'Confirm'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onCancel(n)}
                disabled={state === 'working'}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  height: 40,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.fill,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text variant="subhead">Cancel</Text>
              </Pressable>
            </Row>
          ) : (
            <Row gap={spacing.sm}>
              <Icon
                name={
                  state === 'done' ? 'checkmark-circle' : state === 'failed' ? 'alert-circle' : 'close-circle'
                }
                size={18}
                tone={state === 'done' ? 'positive' : state === 'failed' ? 'negative' : 'secondary'}
              />
              <Text
                variant="footnote"
                tone={state === 'done' ? 'positive' : state === 'failed' ? 'negative' : 'secondary'}
                style={{ flex: 1 }}
              >
                {state === 'cancelled' ? 'Cancelled — nothing was changed.' : result}
              </Text>
            </Row>
          )}
        </Card>
      ))}
    </View>
  );
}

function SetupCard({ message }: { message: string }) {
  return (
    <Card style={{ margin: GUTTER, marginBottom: 0, gap: spacing.sm }}>
      <Row gap={spacing.sm}>
        <Icon name="construct-outline" size={20} tone="warning" />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          BUD AI needs one setup step
        </Text>
      </Row>
      <Text variant="footnote" tone="secondary">
        {message} It uses Anthropic’s Claude with your own API key, kept only on your server.
      </Text>
      <Pressable onPress={() => router.back()} accessibilityRole="button">
        <Text variant="subhead" tone="brand">
          Back to Home
        </Text>
      </Pressable>
    </Card>
  );
}
