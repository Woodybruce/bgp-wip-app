export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}
