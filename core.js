/**
 * Deterministic math expression engine. No eval, no Function, no dependencies.
 * Two modes:
 *  - float: IEEE double, output rounded to 15 significant digits (0.1+0.2 -> "0.3")
 *  - exact: arbitrary-precision decimal arithmetic (+ - * / % integer ^ !)
 */

export class CalcError extends Error {
  constructor(message, pos) {
    super(pos != null ? `${message} (position ${pos})` : message);
    this.name = 'CalcError';
    this.pos = pos ?? null;
  }
}

const MAX_EXPR_LENGTH = 2000;
const MAX_BATCH = 50;

/* -------------------------------- tokenizer ------------------------------- */

const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === 'π';
const isIdentPart = (c) => isIdentStart(c) || isDigit(c);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '∞') { tokens.push({ t: 'num', v: Infinity, pos: i }); i++; continue; }
    if (isDigit(c) || c === '.') {
      const start = i;
      let sawDigit = false;
      while (i < src.length && isDigit(src[i])) { i++; sawDigit = true; }
      if (i < src.length && src[i] === '.') {
        i++;
        while (i < src.length && isDigit(src[i])) { i++; sawDigit = true; }
      }
      if (!sawDigit) throw new CalcError(`Unexpected character '.'`, start);
      if (i < src.length && (src[i] === 'e' || src[i] === 'E')) {
        let j = i + 1;
        if (j < src.length && (src[j] === '+' || src[j] === '-')) j++;
        if (j < src.length && isDigit(src[j])) {
          while (j < src.length && isDigit(src[j])) j++;
          i = j;
        }
      }
      tokens.push({ t: 'num', v: src.slice(start, i), pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i++;
      while (i < src.length && isIdentPart(src[i])) i++;
      tokens.push({ t: 'ident', v: src.slice(start, i), pos: start });
      continue;
    }
    if (c === '*' && src[i + 1] === '*') { tokens.push({ t: 'op', v: '^', pos: i }); i += 2; continue; }
    const alias = { '×': '*', '÷': '/', '−': '-' };
    const op = alias[c] ?? c;
    if ('+-*/%^!(),'.includes(op)) { tokens.push({ t: 'op', v: op, pos: i }); i++; continue; }
    throw new CalcError(`Unexpected character '${c}'`, i);
  }
  tokens.push({ t: 'end', pos: src.length });
  return tokens;
}

/* --------------------------------- parser --------------------------------- */

function parse(src) {
  const tokens = tokenize(src);
  let idx = 0;
  const peek = () => tokens[idx];
  const next = () => tokens[idx++];
  const expectOp = (v) => {
    const tk = next();
    if (tk.t !== 'op' || tk.v !== v) throw new CalcError(`Expected '${v}'`, tk.pos);
  };

  function parseExpr() { return parseAdditive(); }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next();
      left = { k: 'bin', op: op.v, l: left, r: parseMultiplicative(), pos: op.pos };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next();
      left = { k: 'bin', op: op.v, l: left, r: parseUnary(), pos: op.pos };
    }
    return left;
  }

  function parseUnary() {
    const tk = peek();
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      next();
      return { k: 'un', op: tk.v, e: parseUnary(), pos: tk.pos };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePostfix();
    const tk = peek();
    if (tk.t === 'op' && tk.v === '^') {
      next();
      return { k: 'bin', op: '^', l: base, r: parseUnary(), pos: tk.pos };
    }
    return base;
  }

  function parsePostfix() {
    let e = parsePrimary();
    while (peek().t === 'op' && peek().v === '!') {
      const tk = next();
      e = { k: 'fact', e, pos: tk.pos };
    }
    return e;
  }

  function parsePrimary() {
    const tk = next();
    if (tk.t === 'num') return { k: 'num', v: tk.v, pos: tk.pos };
    if (tk.t === 'ident') {
      if (peek().t === 'op' && peek().v === '(') {
        next();
        const args = [];
        if (!(peek().t === 'op' && peek().v === ')')) {
          args.push(parseExpr());
          while (peek().t === 'op' && peek().v === ',') { next(); args.push(parseExpr()); }
        }
        expectOp(')');
        return { k: 'call', name: tk.v, args, pos: tk.pos };
      }
      return { k: 'ident', name: tk.v, pos: tk.pos };
    }
    if (tk.t === 'op' && tk.v === '(') {
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    if (tk.t === 'end') throw new CalcError('Unexpected end of expression', tk.pos);
    throw new CalcError(`Unexpected '${tk.v}'`, tk.pos);
  }

  const ast = parseExpr();
  if (peek().t !== 'end') throw new CalcError(`Unexpected '${peek().v}'`, peek().pos);
  return ast;
}

/* ----------------------------- float evaluator ---------------------------- */

const CONSTANTS = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
  π: Math.PI, inf: Infinity, infinity: Infinity,
};

const DOMAIN = 'result is not a finite number (undefined or out of domain)';

function checked(x, pos) {
  if (typeof x !== 'number' || Number.isNaN(x)) throw new CalcError(DOMAIN, pos);
  if (!Number.isFinite(x)) throw new CalcError('result overflowed to infinity', pos);
  return x;
}

function arity(args, n, name, pos) {
  if (args.length !== n) {
    throw new CalcError(`function '${name}' expects ${n} argument(s), got ${args.length}`, pos);
  }
}

/* Fixed-arity functions receive (args: number[], pos) so optional params work. */
const FUNCTIONS = {
  sqrt: (a, p) => { arity(a, 1, 'sqrt', p); if (a[0] < 0) throw new CalcError('sqrt of a negative number', p); return Math.sqrt(a[0]); },
  cbrt: (a, p) => { arity(a, 1, 'cbrt', p); return Math.cbrt(a[0]); },
  abs: (a, p) => { arity(a, 1, 'abs', p); return Math.abs(a[0]); },
  sign: (a, p) => { arity(a, 1, 'sign', p); return Math.sign(a[0]); },
  ceil: (a, p) => { arity(a, 1, 'ceil', p); return Math.ceil(a[0]); },
  floor: (a, p) => { arity(a, 1, 'floor', p); return Math.floor(a[0]); },
  round: (a, p) => { arity(a, 1, 'round', p); return Math.round(a[0]); },
  trunc: (a, p) => { arity(a, 1, 'trunc', p); return Math.trunc(a[0]); },
  exp: (a, p) => { arity(a, 1, 'exp', p); return checked(Math.exp(a[0]), p); },
  expm1: (a, p) => { arity(a, 1, 'expm1', p); return Math.expm1(a[0]); },
  ln: (a, p) => { arity(a, 1, 'ln', p); if (a[0] <= 0) throw new CalcError('ln of a non-positive number', p); return Math.log(a[0]); },
  log: (a, p) => {
    if (a.length === 1) {
      if (a[0] <= 0) throw new CalcError('log of a non-positive number', p);
      return Math.log10(a[0]);
    }
    if (a.length === 2) {
      if (a[0] <= 0 || a[1] <= 0 || a[1] === 1) throw new CalcError('invalid log arguments', p);
      return Math.log(a[0]) / Math.log(a[1]);
    }
    throw new CalcError(`function 'log' expects 1 or 2 argument(s), got ${a.length}`, p);
  },
  log2: (a, p) => { arity(a, 1, 'log2', p); if (a[0] <= 0) throw new CalcError('log2 of a non-positive number', p); return Math.log2(a[0]); },
  log10: (a, p) => { arity(a, 1, 'log10', p); if (a[0] <= 0) throw new CalcError('log10 of a non-positive number', p); return Math.log10(a[0]); },
  sin: (a, p) => { arity(a, 1, 'sin', p); return Math.sin(a[0]); },
  cos: (a, p) => { arity(a, 1, 'cos', p); return Math.cos(a[0]); },
  tan: (a, p) => { arity(a, 1, 'tan', p); return Math.tan(a[0]); },
  asin: (a, p) => { arity(a, 1, 'asin', p); return checked(Math.asin(a[0]), p); },
  acos: (a, p) => { arity(a, 1, 'acos', p); return checked(Math.acos(a[0]), p); },
  atan: (a, p) => { arity(a, 1, 'atan', p); return Math.atan(a[0]); },
  atan2: (a, p) => { arity(a, 2, 'atan2', p); return Math.atan2(a[0], a[1]); },
  sinh: (a, p) => { arity(a, 1, 'sinh', p); return Math.sinh(a[0]); },
  cosh: (a, p) => { arity(a, 1, 'cosh', p); return Math.cosh(a[0]); },
  tanh: (a, p) => { arity(a, 1, 'tanh', p); return Math.tanh(a[0]); },
  pow: (a, p) => { arity(a, 2, 'pow', p); return powFloat(a[0], a[1], p); },
  mod: (a, p) => { arity(a, 2, 'mod', p); if (a[1] === 0) throw new CalcError('modulo by zero', p); return a[0] % a[1]; },
  radians: (a, p) => { arity(a, 1, 'radians', p); return (a[0] * Math.PI) / 180; },
  degrees: (a, p) => { arity(a, 1, 'degrees', p); return (a[0] * 180) / Math.PI; },
};

/* Variadic functions receive only their arguments, no trailing position. */
const VARIADIC = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  hypot: (...a) => Math.hypot(...a),
  gcd: (...a) => {
    const ints = a.map(integerArg('gcd'));
    const g = ints.reduce((x, y) => gcdBig(absBig(x), absBig(y)), 0n);
    return Number(g);
  },
  lcm: (...a) => {
    const ints = a.map(integerArg('lcm'));
    const l = ints.reduce((x, y) => (x === 0n || y === 0n) ? 0n : absBig(x / gcdBig(absBig(x), absBig(y)) * y), 1n);
    return Number(l);
  },
};

function absBig(x) { return x < 0n ? -x : x; }
function gcdBig(a, b) { while (b !== 0n) { [a, b] = [b, a % b]; } return a; }
function integerArg(name) {
  return (x) => {
    if (!Number.isInteger(x)) throw new CalcError(`${name} requires integer arguments`);
    if (Math.abs(x) > Number.MAX_SAFE_INTEGER) throw new CalcError(`${name} argument exceeds safe integer range`);
    return BigInt(x);
  };
}

function factorialFloat(n, pos) {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('factorial requires a non-negative integer', pos);
  if (n > 170) throw new CalcError('factorial overflow (n > 170); use exact mode', pos);
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function powFloat(a, b, pos) {
  const r = Math.pow(a, b);
  if (Number.isNaN(r)) throw new CalcError(`${a}^${b} is not a real number`, pos);
  if (!Number.isFinite(r)) throw new CalcError('result overflowed to infinity', pos);
  return r;
}

function evalFloat(node, vars) {
  switch (node.k) {
    case 'num': return node.v === Infinity ? Infinity : Number(node.v);
    case 'ident': {
      if (Object.hasOwn(vars, node.name)) return vars[node.name];
      if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name];
      throw new CalcError(`Unknown identifier '${node.name}'`, node.pos);
    }
    case 'un': {
      const v = evalFloat(node.e, vars);
      return node.op === '-' ? -v : v;
    }
    case 'fact': return factorialFloat(evalFloat(node.e, vars), node.pos);
    case 'bin': {
      const l = evalFloat(node.l, vars);
      const r = evalFloat(node.r, vars);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': if (r === 0) throw new CalcError('division by zero', node.pos); return l / r;
        case '%': if (r === 0) throw new CalcError('modulo by zero', node.pos); return l % r;
        case '^': return powFloat(l, r, node.pos);
      }
      break;
    }
    case 'call': {
      const variadic = VARIADIC[node.name];
      if (variadic) {
        const args = node.args.map((a) => evalFloat(a, vars));
        if (args.length === 0) throw new CalcError(`function '${node.name}' needs at least one argument`, node.pos);
        return checked(variadic(...args), node.pos);
      }
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new CalcError(`Unknown function '${node.name}'`, node.pos);
      const args = node.args.map((a) => evalFloat(a, vars));
      if (args.some((a) => !Number.isFinite(a))) throw new CalcError('function argument is not finite', node.pos);
      return checked(fn(args, node.pos), node.pos);
    }
  }
  throw new CalcError('internal: unknown node');
}

function formatFloat(x) {
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
  const rounded = parseFloat(x.toPrecision(15));
  return String(rounded);
}

/* ------------------------- exact decimal evaluator ------------------------ */

const EXACT_DIV_DIGITS = 34;
const EXACT_MAX_POW = 999;

class Dec {
  /** value = int * 10^-scale */
  constructor(int, scale = 0) {
    let i = BigInt(int);
    let s = scale;
    if (i === 0n) s = 0;
    while (s > 0 && i % 10n === 0n) { i /= 10n; s--; }
    this.int = i;
    this.scale = s;
  }

  static parse(str, pos) {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(str).trim());
    if (!m || (!m[2] && !m[3])) throw new CalcError(`'${str}' is not a finite decimal number`, pos);
    const digits = (m[2] || '') + (m[3] || '');
    let scale = (m[3] || '').length - (m[4] ? parseInt(m[4], 10) : 0);
    let int = BigInt((m[1] === '-' ? '-' : '') + (digits.replace(/^0+(?=\d)/, '') || '0'));
    if (scale < 0) { int *= 10n ** BigInt(-scale); scale = 0; }
    return new Dec(int, scale);
  }

  static fromNumber(n, pos) {
    if (!Number.isFinite(n)) throw new CalcError('non-finite values are unavailable in exact mode', pos);
    return Dec.parse(String(n), pos);
  }

  align(b) {
    const s = Math.max(this.scale, b.scale);
    return [this.int * 10n ** BigInt(s - this.scale), b.int * 10n ** BigInt(s - b.scale), s];
  }

  add(b) { const [x, y, s] = this.align(b); return new Dec(x + y, s); }
  sub(b) { const [x, y, s] = this.align(b); return new Dec(x - y, s); }
  neg() { return new Dec(-this.int, this.scale); }
  mul(b) { return new Dec(this.int * b.int, this.scale + b.scale); }

  div(b, pos) {
    if (b.int === 0n) throw new CalcError('division by zero', pos);
    const e = BigInt(EXACT_DIV_DIGITS + b.scale - this.scale);
    const num = e >= 0n ? this.int * 10n ** e : this.int / 10n ** -e;
    let q = num / b.int;
    const r = num % b.int;
    if (r !== 0n) {
      const twice = r * 2n;
      if (twice >= (b.int > 0n ? b.int : -b.int) || twice <= -(b.int > 0n ? b.int : -b.int)) {
        q += (num >= 0n) === (b.int > 0n) ? 1n : -1n;
      }
    }
    return new Dec(q, EXACT_DIV_DIGITS);
  }

  mod(b, pos) {
    if (b.int === 0n) throw new CalcError('modulo by zero', pos);
    const q = this.div(b, pos);
    const trunc = new Dec(q.int / 10n ** BigInt(q.scale), 0); // truncate toward zero
    return this.sub(b.mul(trunc));
  }

  powInt(n, pos) {
    if (n < 0n) return new Dec(1n, 0).div(this.powInt(-n, pos), pos);
    if (n > BigInt(EXACT_MAX_POW)) throw new CalcError(`exponent too large for exact mode (max ${EXACT_MAX_POW})`, pos);
    let base = this;
    let result = new Dec(1n, 0);
    let e = n;
    while (e > 0n) {
      if (e & 1n) result = result.mul(base);
      base = base.mul(base);
      e >>= 1n;
      const digits = result.int.toString().replace('-', '').length;
      if (digits > 20000) throw new CalcError('exact result exceeded 20000 digits', pos);
    }
    return result;
  }

  isInteger() { return this.scale === 0; }

  toString() {
    const neg = this.int < 0n;
    let digits = (neg ? -this.int : this.int).toString();
    if (this.scale === 0) return (neg ? '-' : '') + digits;
    if (digits.length <= this.scale) digits = '0'.repeat(this.scale - digits.length + 1) + digits;
    const cut = digits.length - this.scale;
    return `${neg ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
  }
}

function factorialBig(n) {
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

function evalExact(node, vars) {
  switch (node.k) {
    case 'num': return Dec.parse(node.v, node.pos);
    case 'ident': {
      if (Object.hasOwn(vars, node.name)) return vars[node.name];
      if (Object.hasOwn(CONSTANTS, node.name)) {
        throw new CalcError(`constant '${node.name}' is irrational/non-finite and unavailable in exact mode`, node.pos);
      }
      throw new CalcError(`Unknown identifier '${node.name}'`, node.pos);
    }
    case 'un': {
      const v = evalExact(node.e, vars);
      return node.op === '-' ? v.neg() : v;
    }
    case 'fact': {
      const v = evalExact(node.e, vars);
      if (!v.isInteger() || v.int < 0n) throw new CalcError('factorial requires a non-negative integer', node.pos);
      if (v.int > 1000n) throw new CalcError('factorial too large for exact mode (n > 1000)', node.pos);
      return new Dec(factorialBig(v.int), 0);
    }
    case 'bin': {
      const l = evalExact(node.l, vars);
      const r = evalExact(node.r, vars);
      switch (node.op) {
        case '+': return l.add(r);
        case '-': return l.sub(r);
        case '*': return l.mul(r);
        case '/': return l.div(r, node.pos);
        case '%': return l.mod(r, node.pos);
        case '^': {
          if (!r.isInteger()) throw new CalcError('exact mode requires an integer exponent', node.pos);
          return l.powInt(r.int, node.pos);
        }
      }
      break;
    }
    case 'call':
      throw new CalcError(`function '${node.name}' is unavailable in exact mode (only + - * / % integer ^ and !)`, node.pos);
  }
  throw new CalcError('internal: unknown node');
}

/* --------------------------------- public --------------------------------- */

function coerceVariables(variables, exact) {
  const out = {};
  if (variables == null) return out;
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    throw new CalcError('variables must be an object mapping names to numbers');
  }
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'number') {
      out[name] = exact ? Dec.fromNumber(value) : value;
    } else if (typeof value === 'string' && value.trim() !== '') {
      out[name] = exact ? Dec.parse(value) : checked(Number(value));
    } else {
      throw new CalcError(`variable '${name}' must be a number or numeric string`);
    }
  }
  return out;
}

/**
 * @param {{expression: string|string[], variables?: Record<string, number|string>, precision?: 'float'|'exact'}} input
 * @returns {{results: Array<{expression: string, result?: string, error?: string}>, precision: string}}
 */
export function calculate(input) {
  const { expression, variables, precision = 'float' } = input ?? {};
  if (precision !== 'float' && precision !== 'exact') {
    throw new CalcError(`precision must be "float" or "exact", got '${precision}'`);
  }
  const exprs = Array.isArray(expression) ? expression : [expression];
  if (exprs.length === 0 || exprs.length > MAX_BATCH) {
    throw new CalcError(`expression batch must contain 1..${MAX_BATCH} items`);
  }
  const exact = precision === 'exact';
  const vars = coerceVariables(variables, exact);
  const results = exprs.map((expr) => {
    if (typeof expr !== 'string' || expr.trim() === '') {
      return { expression: String(expr), error: 'expression must be a non-empty string' };
    }
    if (expr.length > MAX_EXPR_LENGTH) {
      return { expression: expr.slice(0, 80) + '…', error: `expression too long (max ${MAX_EXPR_LENGTH} chars)` };
    }
    try {
      const ast = parse(expr);
      const value = exact ? evalExact(ast, vars) : evalFloat(ast, vars);
      const text = exact ? value.toString() : formatFloat(value);
      return { expression: expr, result: text };
    } catch (err) {
      if (err instanceof CalcError) return { expression: expr, error: err.message };
      throw err;
    }
  });
  return { results, precision };
}
