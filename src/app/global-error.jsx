"use client";

// Replaces the root layout when it fails, so none of the app's theme or
// providers exist here: plain elements, inline styles only (the CSP allows
// style attributes), and system colors so light/dark follow the device.
// No error text is shown.
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, colorScheme: "light dark", background: "Canvas", color: "CanvasText", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.75, lineHeight: 1.5 }}>
            Team Flow couldn&apos;t load. Try again; if it keeps happening, come back in a few minutes.
          </p>
          <button type="button" onClick={() => reset()} style={{ font: "inherit", padding: "8px 16px", cursor: "pointer" }}>
            Try again
          </button>
          {error?.digest && <p style={{ fontSize: 12, opacity: 0.6, marginTop: 16 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
