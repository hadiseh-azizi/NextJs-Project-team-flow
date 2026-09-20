// A thin wrapper around fetch for calls to our own API routes. Plain fetch()
// only rejects on network failure — a 401/403/500 response still resolves
// successfully, so call sites that don't check `res.ok` end up treating
// failed requests as if they'd succeeded (closing dialogs, clearing forms,
// moving on) with no feedback to the user. This wrapper makes that mistake
// harder: it throws an Error carrying the server's message on any non-2xx
// response, so a single try/catch at the call site is enough to catch it.
export async function apiFetch(input, init) {
  const res = await fetch(input, init);

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // Response wasn't JSON (or was empty) — fall back to the generic message.
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

// Convenience helper for the common "friendly message to show the user"
// case, so call sites don't all need their own instanceof/fallback logic.
export function errorMessage(err, fallback = "Something went wrong. Please try again.") {
  return err instanceof Error && err.message ? err.message : fallback;
}
