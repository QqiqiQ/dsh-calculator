import { calculate, CalcError } from './core.js';

const TOOL_DESCRIPTION =
  'Evaluate math expressions with a deterministic engine instead of mental arithmetic. ' +
  'Use for any numeric computation: arithmetic, powers, roots, trig, logarithms, factorials, ' +
  'variables, batches, and exact decimal mode for money-style math. ' +
  'Returns exact result strings or position-tagged errors to fix and retry.';

const FUNCTION_LIST =
  'sqrt cbrt abs sign ceil floor round trunc exp expm1 ln log(x) log(x,base) log2 log10 ' +
  'sin cos tan asin acos atan atan2 sinh cosh tanh pow mod gcd lcm min max hypot radians degrees';

function renderText(value) {
  const lines = value.results.map((r) =>
    r.error ? `${r.expression}  →  error: ${r.error}` : `${r.expression}  =  ${r.result}`
  );
  return lines.join('\n');
}

const definition = {
  name: 'calculate',
  description: TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      expression: {
        oneOf: [
          { type: 'string', description: 'Expression to evaluate, e.g. "sqrt(2)^2" or "2*pi*r".' },
          { type: 'array', items: { type: 'string' }, description: 'Batch: up to 50 expressions evaluated in one call.' },
        ],
        description:
          'Operators: + - * / ^(or **) % ! and parentheses; constants: pi e tau phi inf; ' + `functions: ${FUNCTION_LIST}.`,
      },
      variables: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional variable values referenced by name in the expression, e.g. {"r": 3.5}.',
      },
      precision: {
        type: 'string',
        enum: ['float', 'exact'],
        description:
          '"float" (default): IEEE double, output rounded to 15 significant digits. ' +
          '"exact": arbitrary-precision decimal for + - * / %, integer ^ and !; ' +
          'functions and irrational constants are rejected in exact mode.',
      },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              expression: { type: 'string' },
              result: { type: 'string' },
              error: { type: 'string' },
            },
            required: ['expression'],
          },
        },
        precision: { type: 'string', enum: ['float', 'exact'] },
      },
      required: ['results', 'precision'],
    },
    render(_args, value) {
      return [{ type: 'text', text: renderText(value) }];
    },
  },
  timeoutMs: 10000,
  isConcurrencySafe: () => true,
  async execute(args) {
    try {
      return calculate(args);
    } catch (err) {
      if (err instanceof CalcError) {
        return { results: [{ expression: '', error: err.message }], precision: args?.precision ?? 'float' };
      }
      throw err;
    }
  },
};

// Prompt section nudging the model to delegate every numeric computation to the
// calculate tool instead of doing mental arithmetic (the anti-hallucination goal).
// order 4950 sits inside the tool-guidance region, just before TOOLS_SDK (5000).
const CALCULATOR_PROMPT =
  '计算规则:任何数值计算都交给 calculate 工具,不要心算:\n' +
  '- 涉及算术、幂、开方、三角、对数、阶乘、进制换算等任何数值结果时,先调 calculate,不要凭记忆给数字;\n' +
  '- 表达式里可以引用 variables 传入的变量;多条表达式用数组批量提交,一次最多 50 条;\n' +
  '- 金额、账目等要求精确十进制的场景用 precision: "exact"(仅支持 + - * / %、整数 ^ 和 !);\n' +
  '- 工具返回 error 时按错误位置和提示修正表达式后重试,不要编造结果;\n' +
  '- 最终回复里引用 calculate 返回的精确结果,不要四舍五入后改写。';

export const inject = ['tools'];

export function apply(ctx) {
  const disposeTool = ctx.tools.register(definition);
  // Inject the rules through the assemble waterfall (the mechanism dsh-meme uses):
  // no systemPrompt service declaration is needed, so a missing or renamed service
  // can never fail this plugin's whole apply() and take the tool down with it.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next();
    assembled.sections.push({ name: 'dsh-calculator:rules', text: CALCULATOR_PROMPT });
    return assembled;
  });
  return () => disposeTool?.();
}
