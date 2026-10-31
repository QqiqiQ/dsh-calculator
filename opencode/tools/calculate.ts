// OpenCode custom tool: deterministic math evaluation, sharing the same engine as the DSH plugin.
// Install: copy this file together with `calculator.core.js` (a copy of core.js from this package)
// into `.opencode/tools/` (project) or `~/.config/opencode/tools/` (global).
// Tool name comes from the filename: `calculate` requires naming this file `calculate.ts`.
import { tool } from "@opencode-ai/plugin"
import { calculate } from "./calculator.core.js"

const FUNCTION_LIST =
  "sqrt cbrt abs sign ceil floor round trunc exp expm1 ln log(x) log(x,base) log2 log10 " +
  "sin cos tan asin acos atan atan2 sinh cosh tanh pow mod gcd lcm min max hypot radians degrees"

const MATRIX_SYNTAX =
  "Matrices: [[1,2],[3,4]] (row vectors like [1,2,3]); + - * (matrix multiply), A^n integer power, " +
  "A' transpose; functions: det inv transpose trace rank solve(A,b) dot cross norm eye zeros ones shape. " +
  "Matrices are unavailable in exact mode."

const CALCULUS_SYNTAX =
  "Numeric calculus (float mode only): integrate(f, x, a, b) definite integral of expression f over x in [a,b] " +
  "(finite bounds), deriv(f, x, p) derivative of f at point p. Results carry ~12 significant digits."

export default tool({
  description:
    "Evaluate math expressions with a deterministic engine instead of mental arithmetic. " +
    "Use for any numeric computation: arithmetic, powers, roots, trig, logarithms, factorials, " +
    "matrix math, variables, batches, and exact decimal mode for money-style math. " +
    "Returns exact result strings or position-tagged errors to fix and retry.",
  args: {
    expression: tool.schema
      .union([tool.schema.string(), tool.schema.array(tool.schema.string()).max(50)])
      .describe(
        'Expression(s) to evaluate, e.g. "sqrt(2)^2" or "2*pi*r". ' +
          "Operators: + - * / ^(or **) % ! and parentheses; constants: pi e tau phi inf; " +
          `functions: ${FUNCTION_LIST}. ${MATRIX_SYNTAX} ${CALCULUS_SYNTAX}`
      ),
    variables: tool.schema
      .record(tool.schema.string(), tool.schema.any())
      .optional()
      .describe(
        'Optional variable values referenced by name in the expression, e.g. {"r": 3.5}; ' +
          "a value may also be a matrix as number[][] or a vector as number[]."
      ),
    precision: tool.schema
      .enum(["float", "exact"])
      .optional()
      .describe(
        '"float" (default): IEEE double, output rounded to 15 significant digits. ' +
          '"exact": arbitrary-precision decimal for + - * / %, integer ^ and !; ' +
          "functions and irrational constants are rejected in exact mode."
      ),
  },
  async execute(args) {
    const out = calculate(args)
    return out.results
      .map((r) => (r.error ? `${r.expression}  →  error: ${r.error}` : `${r.expression}  =  ${r.result}`))
      .join("\n")
  },
})
