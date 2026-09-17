export function getClientIp(headers: { get: (name: string) => string | null | undefined }): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip') || 'anonymous';
}
