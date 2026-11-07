// JSONC reader with source line numbers.
//
// tsconfig.json is JSON with comments and trailing commas (TypeScript accepts
// both), so JSON.parse is not an option. Every node keeps the line it started
// on, because findings must cite the line a reader can open.
//
// Rejects malformed input with `JsoncError`; the CLI reports that as "our
// parser", never as "your file is wrong".

export class JsoncError extends Error {
  constructor(message, line) {
    super(line == null ? message : `line ${line}: ${message}`);
    this.name = 'JsoncError';
    this.line = line == null ? null : line;
  }
}

class Reader {
  constructor(text) {
    this.s = text.replace(/^\uFEFF/, '');
    this.i = 0;
    this.line = 1;
  }

  eof() {
    return this.i >= this.s.length;
  }

  peek(offset = 0) {
    return this.s[this.i + offset];
  }

  next() {
    const ch = this.s[this.i];
    this.i += 1;
    if (ch === '\n') this.line += 1;
    return ch;
  }

  skipTrivia() {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.next();
        continue;
      }
      if (ch === '/' && this.peek(1) === '/') {
        while (!this.eof() && this.peek() !== '\n') this.next();
        continue;
      }
      if (ch === '/' && this.peek(1) === '*') {
        this.next();
        this.next();
        while (!this.eof() && !(this.peek() === '*' && this.peek(1) === '/')) this.next();
        if (this.eof()) throw new JsoncError('unterminated block comment', this.line);
        this.next();
        this.next();
        continue;
      }
      return;
    }
  }

  value() {
    this.skipTrivia();
    const ch = this.peek();
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    if (ch === '"') {
      const line = this.line;
      return { type: 'string', line, value: this.string() };
    }
    if (this.s.startsWith('true', this.i)) {
      const line = this.line;
      for (let k = 0; k < 4; k += 1) this.next();
      return { type: 'boolean', line, value: true };
    }
    if (this.s.startsWith('false', this.i)) {
      const line = this.line;
      for (let k = 0; k < 5; k += 1) this.next();
      return { type: 'boolean', line, value: false };
    }
    if (this.s.startsWith('null', this.i)) {
      const line = this.line;
      for (let k = 0; k < 4; k += 1) this.next();
      return { type: 'null', line, value: null };
    }
    const line = this.line;
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (!match) throw new JsoncError(`unexpected character "${ch ?? '<eof>'}"`, line);
    for (let k = 0; k < match[0].length; k += 1) this.next();
    return { type: 'number', line, value: Number(match[0]) };
  }

  string() {
    this.next(); // opening quote
    let out = '';
    for (;;) {
      if (this.eof()) throw new JsoncError('unterminated string', this.line);
      const ch = this.next();
      if (ch === '"') return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = this.next();
      const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
      if (Object.hasOwn(simple, esc)) {
        out += simple[esc];
        continue;
      }
      if (esc === 'u') {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JsoncError('bad \\u escape', this.line);
        for (let k = 0; k < 4; k += 1) this.next();
        out += String.fromCharCode(parseInt(hex, 16));
        continue;
      }
      throw new JsoncError(`unsupported escape \\${esc}`, this.line);
    }
  }

  object() {
    const line = this.line;
    this.next(); // {
    const entries = [];
    for (;;) {
      this.skipTrivia();
      if (this.peek() === '}') {
        this.next();
        return { type: 'object', line, entries };
      }
      const keyLine = this.line;
      if (this.peek() !== '"') throw new JsoncError('expected a quoted key', this.line);
      const key = this.string();
      this.skipTrivia();
      if (this.peek() !== ':') throw new JsoncError('expected ":"', this.line);
      this.next();
      const value = this.value();
      entries.push({ key, keyLine, value });
      this.skipTrivia();
      if (this.peek() === ',') {
        this.next();
        continue;
      }
      if (this.peek() === '}') {
        this.next();
        return { type: 'object', line, entries };
      }
      throw new JsoncError('expected "," or "}"', this.line);
    }
  }

  array() {
    const line = this.line;
    this.next(); // [
    const items = [];
    for (;;) {
      this.skipTrivia();
      if (this.peek() === ']') {
        this.next();
        return { type: 'array', line, items };
      }
      items.push(this.value());
      this.skipTrivia();
      if (this.peek() === ',') {
        this.next();
        continue;
      }
      if (this.peek() === ']') {
        this.next();
        return { type: 'array', line, items };
      }
      throw new JsoncError('expected "," or "]"', this.line);
    }
  }
}

/** Parse JSONC into a line-tagged tree. */
export function parseJsonc(text) {
  const reader = new Reader(text);
  const root = reader.value();
  reader.skipTrivia();
  if (!reader.eof()) throw new JsoncError('trailing content after the document', reader.line);
  return root;
}

/** Get an object entry by key. */
export function getEntry(node, key) {
  if (!node || node.type !== 'object') return undefined;
  return node.entries.find((entry) => entry.key === key);
}

/** Get an object value by key. */
export function getValue(node, key) {
  return getEntry(node, key)?.value;
}

/** Convert to plain JavaScript values. */
export function toPlain(node) {
  if (!node) return null;
  if (node.type === 'object') {
    const out = {};
    for (const entry of node.entries) out[entry.key] = toPlain(entry.value);
    return out;
  }
  if (node.type === 'array') return node.items.map(toPlain);
  return node.value;
}
