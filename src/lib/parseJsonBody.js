// req.json() throws on an empty body, non-JSON body, or malformed JSON.
// Left unguarded, that surfaces to the client as an unstyled 500 instead of
// a controlled 400. Routes should await this instead and check for null.
export async function parseJsonBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
