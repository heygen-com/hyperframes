/**
 * BERT WordPiece tokenization, implemented directly rather than pulled in.
 *
 * The obvious dependencies both failed: the standalone tokenizer package ships
 * builder components with no way to load a `tokenizer.json`, and the full
 * wrapper costs 359 MB installed because it pins an exact ONNX runtime and ends
 * up with a second native copy plus an unused web runtime. This is ~120 lines
 * with no dependencies at all.
 *
 * Hand-writing a tokenizer is normally a bad idea, because wrong token ids
 * still produce plausible-looking embeddings and plausible-looking rankings.
 * Nothing fails loudly. That is why `wordpiece.parity.test.ts` compares this
 * implementation's ids against a reference implementation over a corpus rather
 * than asserting a handful of cases by eye.
 *
 * The pipeline reproduces the config in the model's own tokenizer.json:
 * BertNormalizer (clean text, isolate CJK, strip accents, lowercase), then
 * BertPreTokenizer (whitespace split, punctuation isolated), then greedy
 * longest-match-first WordPiece, then [CLS] ... [SEP].
 */

export interface WordPieceConfig {
  vocab: Record<string, number>;
  unkToken: string;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
  clsToken: string;
  sepToken: string;
}

export interface Encoding {
  ids: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

/** Read the pieces this tokenizer needs out of a HuggingFace tokenizer.json. */
export function configFromTokenizerJson(raw: string): WordPieceConfig {
  const parsed = JSON.parse(raw) as {
    model: {
      vocab: Record<string, number>;
      unk_token?: string;
      continuing_subword_prefix?: string;
      max_input_chars_per_word?: number;
    };
  };
  const model = parsed.model;
  if (!model?.vocab) throw new Error("tokenizer.json has no WordPiece vocab");
  return {
    vocab: model.vocab,
    unkToken: model.unk_token ?? "[UNK]",
    continuingSubwordPrefix: model.continuing_subword_prefix ?? "##",
    maxInputCharsPerWord: model.max_input_chars_per_word ?? 100,
    clsToken: "[CLS]",
    sepToken: "[SEP]",
  };
}

/**
 * BertNormalizer.
 *
 * Control characters are dropped and every whitespace variant collapses to a
 * plain space. CJK characters are isolated so each becomes its own token, which
 * is what the reference does even for an English-only model.
 */
export function normalize(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code === 0 || code === 0xfffd) continue;
    if (isControl(char, code)) continue;
    if (isWhitespace(char, code)) {
      out += " ";
      continue;
    }
    out += isChinese(code) ? ` ${char} ` : char;
  }
  // Strip accents after lowercasing: NFD splits a letter from its mark, and the
  // marks are then dropped. Mirrors strip_accents defaulting to lowercase.
  return out
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/** BertPreTokenizer: split on whitespace, then break punctuation into its own token. */
export function preTokenize(normalized: string): string[] {
  const words: string[] = [];
  for (const chunk of normalized.split(/\s+/)) {
    if (!chunk) continue;
    let current = "";
    for (const char of chunk) {
      if (isPunctuation(char)) {
        if (current) words.push(current);
        words.push(char);
        current = "";
      } else {
        current += char;
      }
    }
    if (current) words.push(current);
  }
  return words;
}

/** Greedy longest-match-first, the reference WordPiece algorithm. */
export function wordPiece(word: string, config: WordPieceConfig): string[] {
  if ([...word].length > config.maxInputCharsPerWord) return [config.unkToken];

  const pieces: string[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let match: string | null = null;
    while (start < end) {
      const candidate =
        start === 0
          ? word.slice(start, end)
          : config.continuingSubwordPrefix + word.slice(start, end);
      if (candidate in config.vocab) {
        match = candidate;
        break;
      }
      end -= 1;
    }
    // A single unmatchable piece makes the whole word unknown, not just that
    // piece. Emitting partial pieces here would silently change the embedding.
    if (match === null) return [config.unkToken];
    pieces.push(match);
    start = end;
  }
  return pieces;
}

export function encode(text: string, config: WordPieceConfig): Encoding {
  const tokens = [config.clsToken];
  for (const word of preTokenize(normalize(text))) tokens.push(...wordPiece(word, config));
  tokens.push(config.sepToken);

  const unk = config.vocab[config.unkToken] as number;
  const ids = tokens.map((token) => config.vocab[token] ?? unk);
  return {
    ids,
    attentionMask: ids.map(() => 1),
    tokenTypeIds: ids.map(() => 0),
  };
}

function isControl(char: string, code: number): boolean {
  if (char === "\t" || char === "\n" || char === "\r") return false;
  return code < 32 || code === 127 || /\p{Cc}|\p{Cf}/u.test(char);
}

function isWhitespace(char: string, code: number): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    code === 0x0b ||
    code === 0x0c ||
    /\p{Zs}/u.test(char)
  );
}

function isPunctuation(char: string): boolean {
  const code = char.codePointAt(0) as number;
  // ASCII non-alphanumerics, plus Unicode punctuation categories only.
  // Symbol categories are deliberately excluded: the reference leaves a symbol
  // attached to the preceding token, so "360°" becomes 360 + ##° rather than
  // two separate words. Including \p{S} here silently changed the embedding of
  // every description containing one, which the parity corpus caught.
  const asciiSymbol =
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126);
  return asciiSymbol || /\p{P}/u.test(char);
}

// a Unicode block test; the ranges are data, and 16 cyclomatic is what checking them costs
// fallow-ignore-next-line complexity
function isChinese(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f)
  );
}
