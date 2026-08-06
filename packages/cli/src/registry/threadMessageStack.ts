export const THREAD_MESSAGE_STACK_ITEM_NAME = "thread-message-stack";
export const THREAD_MESSAGE_STACK_DATA_SELECTOR = "data-hf-primitive-data";

const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 8_192;
const MAX_SENDER_LENGTH = 256;
const DATA_BLOCK_RE =
  /(<div\b(?=[^>]*\bdata-hf-primitive-data(?:\s|=|>))[^>]*>)([\s\S]*?)(<\/div>)/gi;

export interface ThreadMessageStackMessage {
  side: "incoming" | "outgoing";
  text: string;
  sender?: string;
}

export interface ThreadMessageStackData {
  messages: ThreadMessageStackMessage[];
  stagger?: number;
  hold?: number;
}

function assertFiniteScalar(value: unknown, name: "stagger" | "hold"): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 60) {
    throw new Error(`thread-message-stack ${name} must be a finite number from 0 to 60.`);
  }
}

// Validation enumerates every bounded authored field before any file mutation.
// fallow-ignore-next-line complexity
export function validateThreadMessageStackData(value: unknown): ThreadMessageStackData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("thread-message-stack data must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new Error("thread-message-stack messages must contain at least one message.");
  }
  if (record.messages.length > MAX_MESSAGES) {
    throw new Error(`thread-message-stack supports at most ${MAX_MESSAGES} messages per install.`);
  }

  // Each authored message field is independently bounded before materialization.
  // fallow-ignore-next-line complexity
  const messages = record.messages.map((candidate, index): ThreadMessageStackMessage => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`thread-message-stack messages[${index}] must be an object.`);
    }
    const message = candidate as Record<string, unknown>;
    if (message.side !== "incoming" && message.side !== "outgoing") {
      throw new Error(`thread-message-stack messages[${index}].side must be incoming or outgoing.`);
    }
    if (typeof message.text !== "string") {
      throw new Error(`thread-message-stack messages[${index}].text must be a string.`);
    }
    if (message.text.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `thread-message-stack messages[${index}].text must be at most ${MAX_TEXT_LENGTH} characters.`,
      );
    }
    if (message.sender !== undefined && typeof message.sender !== "string") {
      throw new Error(`thread-message-stack messages[${index}].sender must be a string.`);
    }
    if (typeof message.sender === "string" && message.sender.length > MAX_SENDER_LENGTH) {
      throw new Error(
        `thread-message-stack messages[${index}].sender must be at most ${MAX_SENDER_LENGTH} characters.`,
      );
    }
    return {
      side: message.side,
      text: message.text,
      ...(message.sender !== undefined ? { sender: message.sender } : {}),
    };
  });

  if (record.stagger !== undefined) assertFiniteScalar(record.stagger, "stagger");
  if (record.hold !== undefined) assertFiniteScalar(record.hold, "hold");
  return {
    messages,
    ...(record.stagger !== undefined ? { stagger: record.stagger } : {}),
    ...(record.hold !== undefined ? { hold: record.hold } : {}),
  };
}

function locateDataBlock(source: string): RegExpMatchArray {
  const matches = [...source.matchAll(DATA_BLOCK_RE)];
  if (matches.length !== 1) {
    throw new Error(
      `thread-message-stack source must contain exactly one ${THREAD_MESSAGE_STACK_DATA_SELECTOR} JSON block; found ${matches.length}.`,
    );
  }
  return matches[0]!;
}

export function materializeThreadMessageStack(
  source: string,
  input: ThreadMessageStackData,
): string {
  const data = validateThreadMessageStackData(input);
  locateDataBlock(source);
  const serialized = JSON.stringify(data).replace(/</g, "\\u003c");
  DATA_BLOCK_RE.lastIndex = 0;
  return source.replace(DATA_BLOCK_RE, (_match, open: string, _old: string, close: string) => {
    return `${open}${serialized}${close}`;
  });
}

export function parseThreadMessageStackData(source: string): ThreadMessageStackData {
  const match = locateDataBlock(source);
  try {
    return validateThreadMessageStackData(JSON.parse(match[2] ?? ""));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("thread-message-stack data block contains invalid JSON.");
    }
    throw error;
  }
}
