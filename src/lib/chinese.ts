/** Allow product names and metric acronyms, but not an English paragraph with a token Chinese word. */
export function primarilyChinese(text: string): boolean {
  const han = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latinWords = (text.match(/[a-zA-Z]{2,}/g) ?? []).length;
  return han > 0 && latinWords <= Math.max(8, han);
}
