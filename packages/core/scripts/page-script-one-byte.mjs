export function firstCharacterThatMakesPagesTwoByte(text) {
  const wide = /[\u{100}-\u{10ffff}]/u.exec(text);
  return wide && `U+${wide[0].codePointAt(0).toString(16)} at ${wide.index}`;
}
