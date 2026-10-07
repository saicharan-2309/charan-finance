/**
 * Builders for picker options shared by several screens: categories (with
 * their subcategories indented beneath) and payment methods.
 */
import type { SelectOption } from '@/components/ui/pickers';
import { formatMoney } from '@/lib/money';
import { accountVisual, balanceDisplay, providerByKey } from '@/lib/payment-methods';
import type { Account, Category, CategoryKind } from '@/types/domain';

interface CategoryIndexLike {
  top: (kind: CategoryKind, includeArchived?: boolean) => Category[];
  children: Map<string, Category[]>;
  byId: Map<string, Category>;
}

/** Category + subcategory rows. A subcategory's value is "parentId:childId". */
export function categoryOptions(index: CategoryIndexLike, kind: CategoryKind): SelectOption[] {
  return index.top(kind).flatMap((c) => [
    { value: c.id, label: c.name, icon: c.icon, color: c.color },
    ...(index.children.get(c.id) ?? [])
      .filter((s) => !s.isArchived)
      .map((s) => ({
        value: `${c.id}:${s.id}`,
        label: s.name,
        icon: s.icon,
        color: s.color,
        depth: 1,
      })),
  ]);
}

export function splitCategoryValue(value: string): { categoryId: string; subcategoryId: string | null } {
  const [categoryId, subcategoryId] = value.split(':');
  return { categoryId, subcategoryId: subcategoryId ?? null };
}

export function categoryLabel(
  index: CategoryIndexLike,
  categoryId: string | null,
  subcategoryId: string | null,
) {
  const cat = categoryId ? index.byId.get(categoryId) : null;
  const sub = subcategoryId ? index.byId.get(subcategoryId) : null;
  if (!cat) return 'Uncategorised';
  return sub ? `${cat.name} › ${sub.name}` : cat.name;
}

export function accountOptions(accounts: Account[], filter?: (a: Account) => boolean): SelectOption[] {
  return (
    accounts
      // Never offer the system "Friends" balance as somewhere to pay from.
      .filter((a) => a.isActive && !a.systemKind && (!filter || filter(a)))
      .map((a) => {
        const visual = accountVisual(a);
        const display = balanceDisplay(a);
        const issuer = providerByKey(a.provider)?.label ?? a.institution;
        return {
          value: a.id,
          label: a.name,
          subtitle: [
            issuer && issuer !== a.name ? issuer : null,
            a.last4 ? `ends ${a.last4}` : null,
            `${formatMoney(display.amount, a.currency, { decimals: 'never' })}${display.caption ? ` ${display.caption}` : ''}`,
          ]
            .filter(Boolean)
            .join(', '),
          icon: visual.icon,
          color: visual.color,
        };
      })
  );
}
