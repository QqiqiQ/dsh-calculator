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
    if ("()+-*/%^![],'".includes(op)) { tokens.push({ t: 'op', v: op, pos: i }); i++; continue; }
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
    while (peek().t === 'op' && (peek().v === '!' || peek().v === "'")) {
      const tk = next();
      e = tk.v === '!' ? { k: 'fact', e, pos: tk.pos } : { k: 'tpose', e, pos: tk.pos };
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
    if (tk.t === 'op' && tk.v === '[') {
      const items = [];
      if (!(peek().t === 'op' && peek().v === ']')) {
        items.push(parseExpr());
        while (peek().t === 'op' && peek().v === ',') { next(); items.push(parseExpr()); }
      }
      expectOp(']');
      if (items.length === 0) throw new CalcError('empty list literal', tk.pos);
      return { k: 'vec', items, pos: tk.pos };
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

/* ------------------------------- matrices ---------------------------------- */

/** Matrix value: { data: number[][] }, always rectangular, ≥1 row/col. Row vectors are 1×n. */
const isMat = (v) => v !== null && typeof v === 'object' && Array.isArray(v.data);
const mat = (data) => ({ data });

const MAX_MATRIX_ELEMENTS = 1_000_000;

function identity(n) {
  return mat(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
}

function matTranspose(a) {
  const rows = a.data.length, cols = a.data[0].length;
  const out = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = a.data[i][j];
  return mat(out);
}

function shapeMismatch(a, b, pos, op) {
  const sa = `${a.data.length}x${a.data[0].length}`, sb = `${b.data.length}x${b.data[0].length}`;
  return new CalcError(`matrix size mismatch: ${sa} ${op} ${sb}`, pos);
}

function matElementwise(a, b, op, pos) {
  if (a.data.length !== b.data.length || a.data[0].length !== b.data[0].length) throw shapeMismatch(a, b, pos, op);
  const f = op === '+' ? (x, y) => x + y : (x, y) => x - y;
  return mat(a.data.map((row, i) => row.map((x, j) => f(x, b.data[i][j]))));
}

function matScale(a, s) {
  return mat(a.data.map((row) => row.map((x) => x * s)));
}

function matmul(a, b, pos) {
  const ar = a.data.length, ac = a.data[0].length;
  let rhs = b.data;
  let br = b.data.length, bc = b.data[0].length;
  // Convenience: a row vector on the right of an m×n matrix acts as a column vector
  // (A * [x,y] == A * [x,y]'), and the result comes back as a row vector.
  const vectorRhs = br === 1 && bc === ac && ac !== 1;
  if (vectorRhs) {
    rhs = b.data[0].map((v) => [v]);
    br = ac; bc = 1;
  }
  if (ac !== br) throw shapeMismatch(a, b, pos, '*');
  const out = Array.from({ length: ar }, () => new Array(bc).fill(0));
  for (let i = 0; i < ar; i++) {
    for (let k = 0; k < ac; k++) {
      const aik = a.data[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < bc; j++) out[i][j] += aik * rhs[k][j];
    }
  }
  return vectorRhs ? mat([out.map((r) => r[0])]) : mat(out);
}

function needSquare(a, name, pos) {
  if (a.data.length !== a.data[0].length) throw new CalcError(`${name} requires a square matrix`, pos);
}

function matDet(a, pos) {
  needSquare(a, 'det', pos);
  const n = a.data.length;
  const m = a.data.map((r) => r.slice());
  let sign = 1, det = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (m[piv][col] === 0) return 0;
    if (piv !== col) { [m[piv], m[col]] = [m[col], m[piv]]; sign = -sign; }
    const p = m[col][col];
    det *= p;
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / p;
      for (let c = col; c < n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return det * sign;
}

function matInv(a, pos) {
  needSquare(a, 'inv', pos);
  const n = a.data.length;
  const m = a.data.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (m[piv][col] === 0) throw new CalcError('matrix is singular (not invertible)', pos);
    if (piv !== col) [m[piv], m[col]] = [m[col], m[piv]];
    const p = m[col][col];
    for (let c = 0; c < 2 * n; c++) m[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return mat(m.map((r) => r.slice(n)));
}

function matSolve(a, b, pos) {
  needSquare(a, 'solve', pos);
  const n = a.data.length;
  let bb;
  if (b.data.length === 1 && b.data[0].length === n) bb = b.data[0].map((v) => [v]); // row vector -> column
  else if (b.data.length === n) bb = b.data.map((r) => r.slice());
  else throw new CalcError(`solve: right-hand side must be a length-${n} vector or ${n}-row matrix`, pos);
  const k = bb[0].length;
  const m = a.data.map((r, i) => [...r, ...bb[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (m[piv][col] === 0) throw new CalcError('no unique solution (coefficient matrix is singular)', pos);
    if (piv !== col) [m[piv], m[col]] = [m[col], m[piv]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c < n + k; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = Array.from({ length: n }, () => new Array(k));
  for (let col = n - 1; col >= 0; col--) {
    for (let j = 0; j < k; j++) {
      let s = m[col][n + j];
      for (let c = col + 1; c < n; c++) s -= m[col][c] * x[c][j];
      x[col][j] = s / m[col][col];
    }
  }
  return k === 1 ? mat([x.map((r) => r[0])]) : mat(x); // single rhs -> row vector back
}

function matRank(a) {
  const m = a.data.map((r) => r.slice());
  const rows = m.length, cols = m[0].length;
  let maxAbs = 0;
  for (const r of m) for (const v of r) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  const tol = Number.EPSILON * Math.max(rows, cols) * (maxAbs || 1);
  let rank = 0, r0 = 0;
  for (let col = 0; col < cols && r0 < rows; col++) {
    let piv = r0;
    for (let r = r0 + 1; r < rows; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) <= tol) continue;
    [m[piv], m[r0]] = [m[r0], m[piv]];
    for (let r = r0 + 1; r < rows; r++) {
      const f = m[r][col] / m[r0][col];
      if (f === 0) continue;
      for (let c = col; c < cols; c++) m[r][c] -= f * m[r0][c];
    }
    r0++; rank++;
  }
  return rank;
}

function matPow(a, n, pos) {
  if (!Number.isInteger(n)) throw new CalcError('matrix exponent must be an integer', pos);
  needSquare(a, 'matrix power', pos);
  let base = a, e = n;
  if (e < 0) { base = matInv(base, pos); e = -e; }
  let result = identity(a.data.length);
  while (e > 0) {
    if (e & 1) result = matmul(result, base, pos);
    e >>= 1;
    if (e > 0) base = matmul(base, base, pos);
  }
  return result;
}

function scalarBin(op, l, r, pos) {
  switch (op) {
    case '+': return l + r;
    case '-': return l - r;
    case '*': return l * r;
    case '/': if (r === 0) throw new CalcError('division by zero', pos); return l / r;
    case '%': if (r === 0) throw new CalcError('modulo by zero', pos); return l % r;
    case '^': return powFloat(l, r, pos);
  }
  throw new CalcError('internal: unknown operator');
}

function binOpFloat(op, l, r, pos) {
  const lm = isMat(l), rm = isMat(r);
  if (!lm && !rm) return scalarBin(op, l, r, pos);
  if (lm && rm) {
    switch (op) {
      case '+': case '-': return matElementwise(l, r, op, pos);
      case '*': return matmul(l, r, pos);
      case '/': throw new CalcError('matrix/matrix division is undefined; use solve(A, B) or A * inv(B)', pos);
      case '%': throw new CalcError('modulo is undefined for matrices', pos);
      case '^': throw new CalcError('matrix exponent must be a scalar integer, not a matrix', pos);
    }
  }
  if (lm) {
    switch (op) {
      case '*': return matScale(l, r);
      case '/': if (r === 0) throw new CalcError('division by zero', pos); return matScale(l, 1 / r);
      case '^': return matPow(l, r, pos);
      case '+': case '-': throw new CalcError(`cannot ${op === '+' ? 'add' : 'subtract'} a scalar and a matrix`, pos);
      case '%': throw new CalcError('modulo is undefined for matrices', pos);
    }
  }
  switch (op) {
    case '*': return matScale(r, l);
    case '+': case '-': throw new CalcError(`cannot ${op === '+' ? 'add' : 'subtract'} a scalar and a matrix`, pos);
    case '/': case '%': case '^': throw new CalcError(`'${op}' with a matrix right operand is undefined`, pos);
  }
  throw new CalcError('internal: unknown operator');
}

function needMat(v, name, pos) {
  if (!isMat(v)) throw new CalcError(`function '${name}' expects a matrix argument`, pos);
  return v;
}

function needVec(v, name, pos) {
  if (!isMat(v) || v.data.length !== 1) throw new CalcError(`function '${name}' expects vector arguments like [1,2,3]`, pos);
  return v.data[0];
}

function positiveInt(v, name, pos) {
  if (!Number.isInteger(v) || v <= 0) throw new CalcError(`function '${name}' expects positive integer dimension(s)`, pos);
  return v;
}

function matDims(a, name, pos) {
  const r = positiveInt(a[0], name, pos);
  const c = a.length === 2 ? positiveInt(a[1], name, pos) : r;
  if (a.length > 2) throw new CalcError(`function '${name}' expects 1 or 2 argument(s), got ${a.length}`, pos);
  if (r * c > MAX_MATRIX_ELEMENTS) throw new CalcError(`matrix too large (max ${MAX_MATRIX_ELEMENTS} elements)`, pos);
  return [r, c];
}

const MATRIX_FUNCTIONS = {
  det: (a, p) => { arity(a, 1, 'det', p); return matDet(needMat(a[0], 'det', p), p); },
  inv: (a, p) => { arity(a, 1, 'inv', p); return matInv(needMat(a[0], 'inv', p), p); },
  transpose: (a, p) => { arity(a, 1, 'transpose', p); return matTranspose(needMat(a[0], 'transpose', p)); },
  trace: (a, p) => {
    arity(a, 1, 'trace', p);
    const m = needMat(a[0], 'trace', p);
    needSquare(m, 'trace', p);
    let s = 0;
    for (let i = 0; i < m.data.length; i++) s += m.data[i][i];
    return s;
  },
  rank: (a, p) => { arity(a, 1, 'rank', p); return matRank(needMat(a[0], 'rank', p)); },
  solve: (a, p) => { arity(a, 2, 'solve', p); return matSolve(needMat(a[0], 'solve', p), needMat(a[1], 'solve', p), p); },
  dot: (a, p) => {
    arity(a, 2, 'dot', p);
    const u = needVec(a[0], 'dot', p), v = needVec(a[1], 'dot', p);
    if (u.length !== v.length) throw new CalcError(`dot: vector length mismatch (${u.length} vs ${v.length})`, p);
    return u.reduce((s, x, i) => s + x * v[i], 0);
  },
  cross: (a, p) => {
    arity(a, 2, 'cross', p);
    const u = needVec(a[0], 'cross', p), v = needVec(a[1], 'cross', p);
    if (u.length !== 3 || v.length !== 3) throw new CalcError('cross requires two 3-element vectors', p);
    return mat([[u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]]);
  },
  norm: (a, p) => {
    arity(a, 1, 'norm', p);
    const m = needMat(a[0], 'norm', p);
    return checked(Math.hypot(...m.data.flat()), p);
  },
  eye: (a, p) => { arity(a, 1, 'eye', p); return identity(positiveInt(a[0], 'eye', p)); },
  zeros: (a, p) => { const [r, c] = matDims(a, 'zeros', p); return mat(Array.from({ length: r }, () => new Array(c).fill(0))); },
  ones: (a, p) => { const [r, c] = matDims(a, 'ones', p); return mat(Array.from({ length: r }, () => new Array(c).fill(1))); },
  shape: (a, p) => { arity(a, 1, 'shape', p); const m = needMat(a[0], 'shape', p); return mat([[m.data.length, m.data[0].length]]); },
};

function checkedAny(x, pos) {
  if (isMat(x)) {
    for (const row of x.data) {
      for (const v of row) {
        if (Number.isNaN(v)) throw new CalcError(DOMAIN, pos);
        if (!Number.isFinite(v)) throw new CalcError('result overflowed to infinity', pos);
      }
    }
    return x;
  }
  return checked(x, pos);
}

function evalFloat(node, vars) {
  switch (node.k) {
    case 'num': return node.v === Infinity ? Infinity : Number(node.v);
    case 'ident': {
      if (Object.hasOwn(vars, node.name)) return vars[node.name];
      if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name];
      throw new CalcError(`Unknown identifier '${node.name}'`, node.pos);
    }
    case 'vec': {
      const vals = node.items.map((it) => evalFloat(it, vars));
      if (vals.every((v) => typeof v === 'number')) {
        const data = [vals];
        if (vals.length > MAX_MATRIX_ELEMENTS) throw new CalcError('matrix too large', node.pos);
        return mat(data);
      }
      if (vals.every(isMat)) {
        if (!vals.every((v) => v.data.length === 1)) throw new CalcError('matrix rows must be vectors like [1,2,3]', node.pos);
        const cols = vals[0].data[0].length;
        if (!vals.every((v) => v.data[0].length === cols)) throw new CalcError('matrix rows must all have the same length', node.pos);
        if (vals.length * cols > MAX_MATRIX_ELEMENTS) throw new CalcError('matrix too large', node.pos);
        return mat(vals.map((v) => v.data[0]));
      }
      throw new CalcError('list items must be all numbers or all equally-sized row vectors', node.pos);
    }
    case 'tpose': {
      const v = evalFloat(node.e, vars);
      if (!isMat(v)) throw new CalcError(`transpose (') requires a matrix`, node.pos);
      return matTranspose(v);
    }
    case 'un': {
      const v = evalFloat(node.e, vars);
      if (isMat(v)) return node.op === '-' ? mat(v.data.map((r) => r.map((x) => -x))) : v;
      return node.op === '-' ? -v : v;
    }
    case 'fact': {
      const v = evalFloat(node.e, vars);
      if (isMat(v)) throw new CalcError('factorial is undefined for matrices', node.pos);
      return factorialFloat(v, node.pos);
    }
    case 'bin': {
      return binOpFloat(node.op, evalFloat(node.l, vars), evalFloat(node.r, vars), node.pos);
    }
    case 'call': {
      if (node.name === 'integrate') return evalIntegrate(node, vars);
      if (node.name === 'deriv') return evalDeriv(node, vars);
      const variadic = VARIADIC[node.name];
      const fn = variadic ?? FUNCTIONS[node.name] ?? MATRIX_FUNCTIONS[node.name];
      if (!fn) throw new CalcError(`Unknown function '${node.name}'`, node.pos);
      const args = node.args.map((a) => evalFloat(a, vars));
      if (variadic && args.length === 0) throw new CalcError(`function '${node.name}' needs at least one argument`, node.pos);
      if (args.some(isMat) && !MATRIX_FUNCTIONS[node.name]) {
        throw new CalcError(`function '${node.name}' does not accept matrix arguments`, node.pos);
      }
      if (args.some((a) => !isMat(a) && !Number.isFinite(a))) throw new CalcError('function argument is not finite', node.pos);
      return checkedAny(variadic ? variadic(...args) : fn(args, node.pos), node.pos);
    }
  }
  throw new CalcError('internal: unknown node');
}

/* -------------------- numeric calculus (float mode) --------------------- */

/** Wrap an AST as f(x): evaluate with the bound variable added to the scope. */
function makeScopeFunction(fNode, varName, vars, what) {
  return (x) => {
    const scope = Object.assign(Object.create(null), vars);
    scope[varName] = x;
    const v = evalFloat(fNode, scope);
    if (typeof v !== 'number') throw new CalcError(`${what} must evaluate to a number`, fNode.pos);
    if (!Number.isFinite(v)) {
      throw new CalcError(`${what} is not finite near x = ${formatFloat(x)} (singularity or overflow)`, fNode.pos);
    }
    return v;
  };
}

function bindVar(node, fnName) {
  if (node.k !== 'ident') {
    throw new CalcError(`${fnName}'s 2nd argument must be a variable name, e.g. ${fnName}(x^2, x, 0, 1)`, node.pos);
  }
  return node.name;
}

/** integrate(f, x, a, b): definite integral via adaptive Simpson quadrature. */
function evalIntegrate(node, vars) {
  if (node.args.length !== 4) {
    throw new CalcError('integrate expects integrate(f, x, a, b): expression, variable, lower bound, upper bound', node.pos);
  }
  const varName = bindVar(node.args[1], 'integrate');
  const a = evalFloat(node.args[2], vars);
  const b = evalFloat(node.args[3], vars);
  if (isMat(a) || isMat(b)) throw new CalcError('integrate bounds must be numbers, not matrices', node.pos);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new CalcError('integrate bounds must be finite (improper integrals are not supported)', node.pos);
  }
  const f = makeScopeFunction(node.args[0], varName, vars, 'integrand');
  return round12(adaptiveSimpson(f, a, b));
}

/** Numeric calculus honestly delivers ~12 digits; strip float noise from the tail. */
const round12 = (v) => parseFloat(v.toPrecision(12));

function adaptiveSimpson(f, a, b) {
  if (a === b) return 0;
  if (b < a) return -adaptiveSimpson(f, b, a);
  const MAX_DEPTH = 20;
  const simpson = (fa, fm, fb, w) => (w / 6) * (fa + 4 * fm + fb);
  const m = (a + b) / 2;
  const fa = f(a), fm = f(m), fb = f(b);
  const whole = simpson(fa, fm, fb, b - a);
  const tol = 1e-12 * (1 + Math.abs(whole));
  function rec(a2, b2, fa2, fm2, fb2, S, depth) {
    const m2 = (a2 + b2) / 2, lm = (a2 + m2) / 2, rm = (m2 + b2) / 2;
    const flm = f(lm), frm = f(rm);
    const left = simpson(fa2, flm, fm2, m2 - a2);
    const right = simpson(fm2, frm, fb2, b2 - m2);
    const err = left + right - S;
    if (depth <= 0 || Math.abs(err) <= 15 * tol) return left + right + err / 15;
    return rec(a2, m2, fa2, flm, fm2, left, depth - 1) + rec(m2, b2, fm2, frm, fb2, right, depth - 1);
  }
  return rec(a, b, fa, fm, fb, whole, MAX_DEPTH);
}

/** deriv(f, x, p): derivative at p via central difference + Richardson extrapolation. */
function evalDeriv(node, vars) {
  if (node.args.length !== 3) {
    throw new CalcError('deriv expects deriv(f, x, point): expression, variable, point', node.pos);
  }
  const varName = bindVar(node.args[1], 'deriv');
  const x0 = evalFloat(node.args[2], vars);
  if (isMat(x0) || !Number.isFinite(x0)) throw new CalcError('deriv point must be a finite number', node.pos);
  const f = makeScopeFunction(node.args[0], varName, vars, 'derivand');
  const h = 1e-3 * Math.max(1, Math.abs(x0));
  const D = (s) => (f(x0 + s) - f(x0 - s)) / (2 * s);
  const d1 = D(h), d2 = D(h / 2), d3 = D(h / 4);
  const r1 = d2 + (d2 - d1) / 3; // Richardson: cancels the O(h^2) term
  const r2 = d3 + (d3 - d2) / 3;
  return round12(r2 + (r2 - r1) / 15); // cancels the O(h^4) term
}

function formatFloat(x) {
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
  const rounded = parseFloat(x.toPrecision(15));
  return String(rounded);
}

function formatValue(x) {
  if (!isMat(x)) return formatFloat(x);
  if (x.data.length === 1) return `[${x.data[0].map(formatFloat).join(', ')}]`;
  return `[${x.data.map((r) => `[${r.map(formatFloat).join(', ')}]`).join(', ')}]`;
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
    case 'vec':
    case 'tpose':
      throw new CalcError('matrices are unavailable in exact mode; use precision "float"', node.pos);
  }
  throw new CalcError('internal: unknown node');
}

/* --------------------------------- public --------------------------------- */

function parseMatVariable(arr, name) {
  if (arr.length === 0) throw new CalcError(`variable '${name}': empty matrix`);
  if (arr.every((v) => typeof v === 'number')) {
    if (!arr.every(Number.isFinite)) throw new CalcError(`variable '${name}': matrix elements must be finite numbers`);
    return mat([arr.slice()]);
  }
  if (arr.every(Array.isArray)) {
    const cols = arr[0].length;
    if (cols === 0) throw new CalcError(`variable '${name}': matrix rows must be non-empty`);
    for (const row of arr) {
      if (row.length !== cols || !row.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new CalcError(`variable '${name}': rows must be equally-sized arrays of finite numbers`);
      }
    }
    if (arr.length * cols > MAX_MATRIX_ELEMENTS) throw new CalcError(`variable '${name}': matrix too large`);
    return mat(arr.map((r) => r.slice()));
  }
  throw new CalcError(`variable '${name}': matrix must be an array of numbers or an array of rows`);
}

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
    } else if (Array.isArray(value)) {
      if (exact) throw new CalcError(`variable '${name}': matrices are unavailable in exact mode`);
      out[name] = parseMatVariable(value, name);
    } else {
      throw new CalcError(`variable '${name}' must be a number, numeric string, or matrix array`);
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
      const text = exact ? value.toString() : formatValue(value);
      return { expression: expr, result: text };
    } catch (err) {
      if (err instanceof CalcError) return { expression: expr, error: err.message };
      throw err;
    }
  });
  return { results, precision };
}
