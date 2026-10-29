# DSH Calculator

A deterministic math tool for [DSH](https://github.com/deepseek-ai/dsh) agents: it gives the model a
real evaluation engine instead of mental arithmetic, so `0.1 + 0.2` answers `0.3` and money math does
not drift.

The engine is a hand-written tokenizer plus a recursive-descent parser — **no `eval`, no `Function`** —
in one dependency-free file, [`core.js`](./core.js).

## What it does

- **Operators**: `+ - * / ^ (or **) % !`, parentheses, unary minus, scientific notation `1.5e-3`,
  and the `× ÷ − ×` aliases.
- **Constants**: `pi e tau phi inf`.
- **Functions**: `sqrt cbrt abs sign ceil floor round trunc exp expm1 ln log(x) log(x,base) log2 log10
  sin cos tan asin acos atan atan2 sinh cosh tanh pow mod gcd lcm min max hypot radians degrees`.
- **Variables**: pass `variables: {"r": 3.5}` and reference `r` in the expression.
- **Batches**: pass an array as `expression`, up to 50 expressions per call.
- **Actionable errors**: syntax, domain and division-by-zero failures come back with a position, so the
  model can correct itself instead of guessing.
- **Two precisions**:
  - `float` (default) — IEEE doubles, output rounded to 15 significant digits.
  - `exact` — arbitrary-precision decimal (BigInt backed) for money math. Supports `+ - * / %`,
    integer `^` and `!`; functions and irrational constants are rejected explicitly rather than
    silently rounded.

## Install

From the plugin market (search for "DSH Calculator"), or by hand:

```powershell
dsh plugin --profile web add https://github.com/QqiqiQ/dsh-calculator/releases/latest/download/dsh-calculator.tgz
```

Then restart `dsh web`. The bundle registers a single `calculate` tool for every session of the profile,
and appends a short usage rule to the system prompt so the model reaches for the tool instead of
estimating.

## Usage

```jsonc
// single expression
{ "expression": "sqrt(2)^2" }                              // → 2
// variables
{ "expression": "2 * pi * r", "variables": { "r": 3 } }    // → 18.8495559215388
// batch
{ "expression": ["0.1 + 0.2", "10!", "log(8, 2)"] }        // → 0.3 / 3628800 / 3
// exact decimal mode
{ "expression": "price * qty",
  "variables": { "price": "19.99", "qty": 3 },
  "precision": "exact" }                                   // → 59.97
```

## OpenCode (optional)

The same engine also runs as an [OpenCode](https://opencode.ai) custom tool —
[`opencode/tools/calculate.ts`](./opencode/tools/calculate.ts); the tool name comes from the filename.
Copy it together with a copy of `core.js` named `calculator.core.js` into `.opencode/tools/` (project)
or `~/.config/opencode/tools/` (global):

```powershell
$dst = "<your project>\.opencode\tools"
New-Item -ItemType Directory -Force $dst
Copy-Item .\opencode\tools\calculate.ts $dst
Copy-Item .\core.js "$dst\calculator.core.js"
```

Re-copy `calculator.core.js` after upgrading the engine, so both sides stay on the same implementation.

## Development

```powershell
node test.js   # 44 assertions, no dependencies
```

## License

MIT
