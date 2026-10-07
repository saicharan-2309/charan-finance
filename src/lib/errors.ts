/**
 * Maps technical errors (Postgres, PostgREST, Auth, network) to messages that
 * are safe and useful for the user. Raw database messages are never shown.
 */

const CODE_MESSAGES: Record<string, string> = {
  CF001: 'Your session has expired. Please sign in again.',
  CF100: 'That change is not allowed.',
  CF101: "An account's currency can't change once it has transactions.",
  CF201: "That account couldn't be found. It may have been deleted.",
  CF202: 'The amount must be in the same currency as the account.',
  CF203: 'That account is archived. Restore it to add transactions.',
  CF204: 'Transfers between different currencies are not supported yet.',
  CF205: 'Amounts can have at most two decimal places.',
  CF206: 'Balance adjustments cannot be edited. Delete it and set the balance again.',
  CF207: "That transaction couldn't be found. It may have been deleted.",
  CF301: "That category couldn't be found.",
  CF302: 'Choose the main category, then the subcategory.',
  CF303: "That category doesn't match the transaction type.",
  CF304: "That subcategory doesn't belong to the selected category.",
  CF305: 'Subcategories cannot have their own subcategories.',
  CF306: "A category's type can't change once it's in use.",
  CF307: "A category that's in use can't be moved.",
  CF401: "You can't withdraw more than has been saved for this goal.",
  CF409: 'This was changed on another device. Pull to refresh and try again.',
  CF501: 'Choose two different merchants to merge.',
  CF502: "That merchant couldn't be found.",
  CF601: "That recurring item couldn't be found.",
  CF602: 'This recurring item is paused.',
  CF603: 'Only the next due payment can be recorded or skipped.',
  CF701: 'Unsupported report grouping.',
  CF702: 'Please choose a shorter date range (up to 10 years).',
  CF801: "That bank message couldn't be found.",
  CF802: 'Add at least one category to file bank transactions under.',
  CF810: 'This sync key is no longer valid. Set up bank sync again.',
  CF811: 'Too many bank messages in the last hour. Try again later.',
  CF812: 'That sync key is not valid.',
  CF813: 'Choose the other account in this payment.',
  CF814: 'This message has already been handled.',
  CF820: 'Only expenses and income can be split.',
  CF821: 'Split into between 2 and 10 parts.',
  CF822: 'Every part needs an amount above zero.',
  CF823: "The parts don't add up to the full amount.",
};

const PG_CODES: Record<string, string> = {
  '23505': 'Something with that name already exists.',
  '23503': "This is still in use, so it can't be deleted. Archive it instead.",
  '23514': 'Some of the values are not valid. Please check and try again.',
  '42501': "You don't have permission to do that.",
  '22003': 'That number is too large.',
  '22P02': 'Some of the values are not in the right format.',
};

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Incorrect email or password.'],
  [/email not confirmed/i, 'Please confirm your email address first — check your inbox.'],
  [/user already registered/i, 'An account with this email already exists. Try signing in.'],
  [/password should be at least/i, 'Password must be at least 8 characters.'],
  [/rate limit|too many requests/i, 'Too many attempts. Please wait a minute and try again.'],
  [/jwt expired|refresh token/i, 'Your session has expired. Please sign in again.'],
  [/weak password|pwned/i, 'That password is too easy to guess. Please choose a stronger one.'],
];

export interface AppErrorInfo {
  message: string;
  /** Whether retrying the same request might succeed. */
  retryable: boolean;
  /** Stable code where known (CFxxx / Postgres SQLSTATE / 'network'). */
  code?: string;
}

function extract(err: unknown): { message: string; code?: string; status?: number } {
  if (!err) return { message: '' };
  if (typeof err === 'string') return { message: err };
  const e = err as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  return {
    message: typeof e.message === 'string' ? e.message : '',
    code: typeof e.code === 'string' ? e.code : undefined,
    status: typeof e.status === 'number' ? e.status : undefined,
  };
}

export function isNetworkError(err: unknown): boolean {
  const { message, status } = extract(err);
  return (
    status === 0 ||
    /network request failed|failed to fetch|network error|timeout|timed out|load failed|offline/i.test(
      message,
    )
  );
}

export function describeError(err: unknown): AppErrorInfo {
  const { message, code, status } = extract(err);

  const cf = /\b(CF\d{3})\b/.exec(message);
  if (cf) {
    // Newer database functions carry their own plain sentence after the code.
    const own = message
      .slice(message.indexOf(cf[1]) + cf[1].length)
      .replace(/^[:\s]+/, '')
      .trim();
    return {
      message: CODE_MESSAGES[cf[1]] ?? (own || 'That action could not be completed.'),
      retryable: false,
      code: cf[1],
    };
  }
  // A database function the app calls doesn't exist on the server yet: the
  // migrations haven't been applied. Say so instead of failing vaguely.
  if (code === 'PGRST202' || code === 'PGRST205') {
    return {
      message:
        'The server hasn’t been updated for this part of BUD yet — apply the latest database migrations.',
      retryable: false,
      code,
    };
  }
  if (isNetworkError(err)) {
    return {
      message: "You're offline or the connection is unstable. Please try again.",
      retryable: true,
      code: 'network',
    };
  }
  for (const [re, text] of AUTH_MESSAGES) {
    if (re.test(message)) return { message: text, retryable: /rate limit/i.test(message), code };
  }
  if (code && PG_CODES[code]) return { message: PG_CODES[code], retryable: false, code };
  if (status === 401 || status === 403) {
    return {
      message: 'Your session has expired. Please sign in again.',
      retryable: false,
      code: String(status),
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      message: 'The server had a problem. Please try again shortly.',
      retryable: true,
      code: String(status),
    };
  }
  return { message: 'Something went wrong. Please try again.', retryable: true, code };
}

/** Development-only technical logging. Never logs amounts, notes or tokens. */
export function logError(context: string, err: unknown): void {
  if (__DEV__) {
    const { message, code, status } = extract(err);
    console.warn(`[${context}]`, code ?? status ?? '', message);
  }
}
