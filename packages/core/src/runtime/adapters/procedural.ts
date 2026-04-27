import type { RuntimeDeterministicAdapter } from "../types";

// ── Restricted Math Evaluator ──────────────────────────────────────────────────
// Tokenizes and parses a minimal expression grammar. NO arbitrary JS execution.
//
// Supported:
//   Literals:    42, 3.14, -7
//   Variables:   frame
//   Operators:   +  -  *  /  %  **
//   Grouping:    ( )
//   Functions:   sin  cos  tan  abs  floor  ceil  round  sqrt  min  max  pow  PI
//
// Anything else (identifiers, property access, function calls, etc.) → returns 0.

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

const ALLOWED_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const ALLOWED_CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
};

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal (including decimals)
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]))) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      const parsed = parseFloat(num);
      if (isNaN(parsed)) return null;
      tokens.push({ type: "number", value: parsed });
      continue;
    }

    // Identifiers (variable names, function names, Math.xxx)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      // Normalize "Math.sin" → "sin", "Math.PI" → "PI", etc.
      if (ident.startsWith("Math.")) {
        ident = ident.slice(5);
      }
      tokens.push({ type: "ident", value: ident });
      continue;
    }

    // Operators
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if ("+-*/%".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    // Parentheses
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }

    // Comma (for multi-arg functions like min, max, pow)
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    // Unknown character → reject entire expression
    return null;
  }

  return tokens;
}

// ── Recursive-descent parser ─────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  private frame: number;
  private failed = false;

  constructor(tokens: Token[], frame: number) {
    this.tokens = tokens;
    this.frame = frame;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }

  // entry → additive
  parse(): number {
    const val = this.additive();
    if (this.pos < this.tokens.length) this.failed = true;
    return this.failed ? 0 : val;
  }

  get hasFailed() {
    return this.failed;
  }

  // additive → multiplicative (('+' | '-') multiplicative)*
  private additive(): number {
    let left = this.multiplicative();
    while (
      this.peek()?.type === "op" &&
      (this.peek()!.value === "+" || this.peek()!.value === "-")
    ) {
      const op = this.advance()!.value;
      const right = this.multiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  // multiplicative → power (('*' | '/' | '%') power)*
  private multiplicative(): number {
    let left = this.power();
    while (this.peek()?.type === "op" && "*/%".includes(this.peek()!.value as string)) {
      const op = this.advance()!.value;
      const right = this.power();
      if (op === "*") left *= right;
      else if (op === "/") left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right;
    }
    return left;
  }

  // power → unary ('**' unary)*
  private power(): number {
    let base = this.unary();
    while (this.peek()?.type === "op" && this.peek()!.value === "**") {
      this.advance();
      const exp = this.unary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  // unary → ('-' | '+') unary | primary
  private unary(): number {
    const t = this.peek();
    if (t?.type === "op" && (t.value === "-" || t.value === "+")) {
      this.advance();
      const val = this.unary();
      return t.value === "-" ? -val : val;
    }
    return this.primary();
  }

  // primary → NUMBER | IDENT | IDENT '(' args ')' | '(' additive ')'
  private primary(): number {
    const t = this.peek();

    // Number literal
    if (t?.type === "number") {
      this.advance();
      return t.value;
    }

    // Parenthesized expression
    if (t?.type === "paren" && t.value === "(") {
      this.advance(); // consume '('
      const val = this.additive();
      if (this.peek()?.type === "paren" && this.peek()!.value === ")") {
        this.advance(); // consume ')'
      } else {
        this.failed = true;
      }
      return val;
    }

    // Identifier: variable, constant, or function call
    if (t?.type === "ident") {
      this.advance();
      const name = t.value;

      // Function call?
      if (this.peek()?.type === "paren" && this.peek()!.value === "(") {
        this.advance(); // consume '('
        const args: number[] = [];

        if (!(this.peek()?.type === "paren" && this.peek()!.value === ")")) {
          args.push(this.additive());
          while (this.peek()?.type === "comma") {
            this.advance(); // consume ','
            args.push(this.additive());
          }
        }

        if (this.peek()?.type === "paren" && this.peek()!.value === ")") {
          this.advance(); // consume ')'
        } else {
          this.failed = true;
          return 0;
        }

        const fn = ALLOWED_FUNCTIONS[name];
        if (fn) return fn(...args);

        // Unknown function → fail safe
        this.failed = true;
        return 0;
      }

      // Known variable
      if (name === "frame") return this.frame;

      // Known constant
      if (name in ALLOWED_CONSTANTS) return ALLOWED_CONSTANTS[name];

      // Unknown identifier → fail safe
      this.failed = true;
      return 0;
    }

    // Nothing matched
    this.failed = true;
    return 0;
  }
}

/**
 * Evaluates a restricted math expression. Returns `{ value, ok }`.
 * If the expression contains anything outside the allowed grammar, `ok` is false
 * and `value` is 0.
 */
export function evaluateExpression(expr: string, frame: number): { value: number; ok: boolean } {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return { value: 0, ok: false };

  const parser = new Parser(tokens, frame);
  const value = parser.parse();

  if (parser.hasFailed || !isFinite(value)) return { value: 0, ok: false };
  return { value, ok: true };
}

// ── Adapter ────────────────────────────────────────────────────────────────────

export function createProceduralAdapter(params: {
  getCanonicalFps: () => number;
}): RuntimeDeterministicAdapter {
  let entries: HTMLElement[] = [];

  const evaluateProceduralAttributes = (domElement: HTMLElement, currentFrame: number) => {
    const attrs = domElement.attributes;
    const transforms: string[] = [];

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.name.startsWith("data-animate-")) {
        const prop = attr.name.slice("data-animate-".length);
        const { value, ok } = evaluateExpression(attr.value, currentFrame);

        if (!ok) continue; // Skip invalid expressions silently

        if (prop === "x") transforms.push(`translateX(${value}px)`);
        else if (prop === "y") transforms.push(`translateY(${value}px)`);
        else if (prop === "scale") transforms.push(`scale(${value})`);
        else if (prop === "rotate" || prop === "rotation") transforms.push(`rotate(${value}deg)`);
        else domElement.style.setProperty(prop, String(value));
      }
    }

    if (transforms.length > 0) {
      domElement.style.transform = transforms.join(" ");
    }
  };

  return {
    name: "procedural",
    discover: () => {
      entries = [];
      const all = document.querySelectorAll("*");
      for (const rawEl of all) {
        if (!(rawEl instanceof HTMLElement)) continue;
        let hasAnimate = false;
        for (let i = 0; i < rawEl.attributes.length; i++) {
          if (rawEl.attributes[i].name.startsWith("data-animate-")) {
            hasAnimate = true;
            break;
          }
        }
        if (hasAnimate) {
          entries.push(rawEl);
        }
      }
    },
    seek: (ctx) => {
      const time = Number(ctx.time) || 0;
      const currentFrame = Math.round(time * params.getCanonicalFps());
      for (const entry of entries) {
        if (!entry.isConnected) continue;
        evaluateProceduralAttributes(entry, currentFrame);
      }
    },
    pause: () => {},
    play: () => {},
    revert: () => {
      entries = [];
    },
  };
}
