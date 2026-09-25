// app/lib/base-url.ts
export function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3700'
}
