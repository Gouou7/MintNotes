/** Match authored container/heading markers, including list continuation indent. */
export function sourceLinePrefix(text: string, inContainer: boolean): string {
  const prefix = /^(?:[\t ]*(?:>[\t ]?|(?:[-+*]|\d+[.)])[\t ]+))*(?:[\t ]*#{1,6}[\t ]+)?/.exec(text)![0];
  const indent = inContainer ? /^[\t ]*/.exec(text.slice(prefix.length))![0] : "";
  return prefix + indent;
}
