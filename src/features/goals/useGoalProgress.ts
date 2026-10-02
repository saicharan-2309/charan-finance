import { useMemo } from 'react';

import { useContributions } from '@/hooks/data';
import { addDaysISO, todayISO } from '@/lib/dates';
import { goalProgress, type GoalProgress } from '@/lib/goals';
import type { Minor } from '@/lib/money';
import type { Goal, GoalContribution } from '@/types/domain';

const WINDOW_DAYS = 90;

/** Pace = net contributions over the last 90 days (or since creation if newer). */
export function progressFor(goal: Goal, contributions: GoalContribution[], now = new Date()): GoalProgress {
  const since = addDaysISO(todayISO(now), -WINDOW_DAYS);
  const created = goal.createdAt.slice(0, 10);
  const windowStart = created > since ? created : since;
  const recent = contributions
    .filter((c) => c.goalId === goal.id && c.contributedOn >= windowStart)
    .reduce((s, c) => s + c.amount, 0) as Minor;
  const days = Math.max(1, Math.round((now.getTime() - new Date(windowStart).getTime()) / 86400000));
  return goalProgress(
    {
      target: goal.targetAmount,
      current: goal.currentAmount,
      targetDate: goal.targetDate,
      recentContributions: recent,
      recentWindowDays: Math.max(days, 14),
    },
    now,
  );
}

export function useGoalProgressMap(goals: Goal[] | undefined) {
  const contributions = useContributions();
  return useMemo(() => {
    const map = new Map<string, GoalProgress>();
    for (const g of goals ?? []) map.set(g.id, progressFor(g, contributions.data ?? []));
    return map;
  }, [goals, contributions.data]);
}
