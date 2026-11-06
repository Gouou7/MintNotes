function reportFailure(code: string, status?: number): void {
  process.stdout.write(`${JSON.stringify({ event: "healthcheck.failed", code, status })}\n`);
  process.exitCode = 1;
}

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  reportFailure("INVALID_PORT");
} else {
  const signal = AbortSignal.timeout(3000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal, redirect: "manual" });
    await response.body?.cancel();
    if (!response.ok) reportFailure("HTTP_ERROR", response.status);
  } catch (error) {
    const cause = error instanceof Error ? error.cause as NodeJS.ErrnoException | undefined : undefined;
    if (signal.aborted) reportFailure("TIMEOUT");
    else if (cause?.code === "ECONNREFUSED") reportFailure("CONNECTION_REFUSED");
    else reportFailure("PROBE_ERROR");
  }
}
