export function escaped(text: string, position: number): boolean {
  let count = 0;
  while (position > 0 && text[--position] === "\\") count++;
  return count % 2 === 1;
}
