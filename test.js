import { calculate } from './core.js';

let pass = 0, fail = 0;

function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function resultOf(input) {
  const r = calculate(input).results[0];
  return r.error ? `ERROR: ${r.error}` : r.result;
}

// float basics
eq(resultOf({ expression: '0.1 + 0.2' }), '0.3', 'float 0.1+0.2');
eq(resultOf({ expression: '2^10' }), '1024', 'power');
eq(resultOf({ expression: '2**10' }), '1024', '** alias');
eq(resultOf({ expression: '-2^2' }), '-4', 'unary minus binds looser than ^');
eq(resultOf({ expression: '(-2)^2' }), '4', 'parenthesized negative base');
eq(resultOf({ expression: '3!' }), '6', 'factorial');
eq(resultOf({ expression: '5! * 2' }), '240', 'factorial in expr');
eq(resultOf({ expression: 'sqrt(2)^2' }), '2', 'sqrt rounding');
eq(resultOf({ expression: 'sin(pi / 6)' }), '0.5', 'trig');
eq(resultOf({ expression: 'log(1000)' }), '3', 'log10');
eq(resultOf({ expression: 'log(8, 2)' }), '3', 'log base');
eq(resultOf({ expression: 'ln(e)' }), '1', 'ln');
eq(resultOf({ expression: 'min(3, 1, 2)' }), '1', 'min variadic');
eq(resultOf({ expression: 'max(3, 1, 2) + hypot(3, 4)' }), '8', 'max+hypot');
eq(resultOf({ expression: 'gcd(12, 18)' }), '6', 'gcd');
eq(resultOf({ expression: 'lcm(4, 6)' }), '12', 'lcm');
eq(resultOf({ expression: '7 % 3' }), '1', 'mod');
eq(resultOf({ expression: '1.5e-3 * 1000' }), '1.5', 'scientific');
eq(resultOf({ expression: '3 × 4 ÷ 2' }), '6', 'unicode ops');
eq(resultOf({ expression: '10 / 4' }), '2.5', 'division');
eq(resultOf({ expression: '2 * pi * 3' }), '18.8495559215388', 'pi formatting');
eq(resultOf({ expression: '1e30 + 1' }), '1e+30', 'big float formatting');

// variables
eq(resultOf({ expression: '2 * pi * r', variables: { r: 3 } }), '18.8495559215388', 'variable');
eq(resultOf({ expression: 'x^2 + y^2', variables: { x: 3, y: 4 } }), '25', 'two vars');

// batch
{
  const r = calculate({ expression: ['1+1', '2*3'] });
  eq(r.results.length, 2, 'batch length');
  eq(r.results[1].result, '6', 'batch second');
}

// errors
eq(resultOf({ expression: '1 / 0' }).startsWith('ERROR: division by zero'), true, 'div zero');
eq(resultOf({ expression: 'sqrt(-1)' }).startsWith('ERROR: sqrt of a negative'), true, 'sqrt neg');
eq(resultOf({ expression: '1 +' }).startsWith('ERROR:'), true, 'syntax error');
eq(resultOf({ expression: 'foo(1)' }).startsWith("ERROR: Unknown function 'foo'"), true, 'unknown fn');
eq(resultOf({ expression: 'abc + 1' }).startsWith("ERROR: Unknown identifier 'abc'"), true, 'unknown ident');
eq(resultOf({ expression: '171!' }).startsWith('ERROR: factorial overflow'), true, 'factorial overflow');

// exact mode
eq(resultOf({ expression: '0.1 + 0.2', precision: 'exact' }), '0.3', 'exact 0.1+0.2');
eq(resultOf({ expression: '1 / 3', precision: 'exact' }), '0.' + '3'.repeat(34), 'exact 1/3');
eq(resultOf({ expression: '2^100', precision: 'exact' }), '1267650600228229401496703205376', 'exact 2^100');
eq(resultOf({ expression: '123456789 * 987654321', precision: 'exact' }), '121932631112635269', 'exact big mul');
eq(resultOf({ expression: '1.5 + 2.25', precision: 'exact' }), '3.75', 'exact decimals');
eq(resultOf({ expression: '20!', precision: 'exact' }), '2432902008176640000', 'exact factorial');
eq(resultOf({ expression: '10 % 3', precision: 'exact' }), '1', 'exact mod');
eq(resultOf({ expression: '2^-2', precision: 'exact' }), '0.25', 'exact negative exponent');
eq(resultOf({ expression: 'price * qty', variables: { price: '19.99', qty: 3 }, precision: 'exact' }), '59.97', 'exact money vars');
eq(resultOf({ expression: 'sqrt(2)', precision: 'exact' }).startsWith("ERROR: function 'sqrt' is unavailable"), true, 'exact fn rejected');
eq(resultOf({ expression: 'pi', precision: 'exact' }).startsWith("ERROR: constant 'pi'"), true, 'exact pi rejected');
eq(resultOf({ expression: '1 / 0', precision: 'exact' }).startsWith('ERROR: division by zero'), true, 'exact div zero');

// matrices (float)
eq(resultOf({ expression: '[[1,2],[3,4]] * [[5,6],[7,8]]' }), '[[19, 22], [43, 50]]', 'matmul');
eq(resultOf({ expression: 'det([[1,2],[3,4]])' }), '-2', 'det');
eq(resultOf({ expression: 'inv([[1,2],[3,4]])' }), '[[-2, 1], [1.5, -0.5]]', 'inv');
eq(resultOf({ expression: 'trace([[1,2],[3,4]])' }), '5', 'trace');
eq(resultOf({ expression: '[[1,2],[3,4]]\'' }), '[[1, 3], [2, 4]]', 'transpose postfix');
eq(resultOf({ expression: 'transpose([[1,2],[3,4]])' }), '[[1, 3], [2, 4]]', 'transpose fn');
eq(resultOf({ expression: '[[1,2],[3,4]]^2' }), '[[7, 10], [15, 22]]', 'matrix power');
eq(resultOf({ expression: '[[1,2],[3,4]]^0' }), '[[1, 0], [0, 1]]', 'matrix power zero');
eq(resultOf({ expression: '[[1,2],[3,4]]^-1' }), '[[-2, 1], [1.5, -0.5]]', 'matrix power negative = inv');
eq(resultOf({ expression: '[1,2,3] + [4,5,6]' }), '[5, 7, 9]', 'vector add');
eq(resultOf({ expression: '2 * [1,2,3]' }), '[2, 4, 6]', 'scalar * vector');
eq(resultOf({ expression: '[2,4,6] / 2' }), '[1, 2, 3]', 'vector / scalar');
eq(resultOf({ expression: '-[[1,2],[3,4]]' }), '[[-1, -2], [-3, -4]]', 'unary minus matrix');
eq(resultOf({ expression: 'dot([1,2,3],[4,5,6])' }), '32', 'dot');
eq(resultOf({ expression: 'cross([1,0,0],[0,1,0])' }), '[0, 0, 1]', 'cross');
eq(resultOf({ expression: 'norm([3,4])' }), '5', 'norm');
eq(resultOf({ expression: 'solve([[2,1],[1,3]],[1,2])' }), '[0.2, 0.6]', 'solve');
eq(resultOf({ expression: 'rank([[1,2],[2,4]])' }), '1', 'rank');
eq(resultOf({ expression: 'rank([[1,2],[3,4]])' }), '2', 'rank full');
eq(resultOf({ expression: 'eye(2) * [[1,2],[3,4]]' }), '[[1, 2], [3, 4]]', 'eye identity');
eq(resultOf({ expression: 'zeros(2)' }), '[[0, 0], [0, 0]]', 'zeros square');
eq(resultOf({ expression: 'ones(2,1)' }), '[[1], [1]]', 'ones rect');
eq(resultOf({ expression: 'shape([[1,2,3],[4,5,6]])' }), '[2, 3]', 'shape');
eq(resultOf({ expression: 'det(A)', variables: { A: [[1, 2], [3, 4]] } }), '-2', 'matrix variable');
eq(resultOf({ expression: 'A * b', variables: { A: [[1, 2], [3, 4]], b: [5, 6] } }), '[17, 39]', 'matrix * vector variable');

// matrix errors
eq(resultOf({ expression: 'det([1,2,3])' }).startsWith('ERROR: det requires a square matrix'), true, 'det nonsquare');
eq(resultOf({ expression: '[[1,2]] + [[1,2,3]]' }).startsWith('ERROR: matrix size mismatch'), true, 'add shape mismatch');
eq(resultOf({ expression: '[[1,2],[3,4]] * [[1,2,3]]' }).startsWith('ERROR: matrix size mismatch'), true, 'matmul mismatch');
eq(resultOf({ expression: 'inv([[1,2],[2,4]])' }).startsWith('ERROR: matrix is singular'), true, 'inv singular');
eq(resultOf({ expression: 'solve([[1,2],[2,4]],[1,2])' }).startsWith('ERROR: no unique solution'), true, 'solve singular');
eq(resultOf({ expression: '[1,2] + 1' }).startsWith('ERROR: cannot add a scalar and a matrix'), true, 'scalar+matrix');
eq(resultOf({ expression: '[[1,2],[3,4]] / [[1,0],[0,1]]' }).startsWith('ERROR: matrix/matrix division is undefined'), true, 'matrix/matrix div');
eq(resultOf({ expression: 'sqrt([1,2])' }).startsWith("ERROR: function 'sqrt' does not accept matrix"), true, 'scalar fn rejects matrix');
eq(resultOf({ expression: '[[1,2],[3,4]]!' }).startsWith('ERROR: factorial is undefined for matrices'), true, 'matrix factorial');
eq(resultOf({ expression: "5'" }).startsWith('ERROR: transpose'), true, 'transpose scalar');
eq(resultOf({ expression: '[[1,2],[3]]' }).startsWith('ERROR: matrix rows must all have the same length'), true, 'ragged matrix');
eq(resultOf({ expression: '[[1,2],[3,4]]', precision: 'exact' }).startsWith('ERROR: matrices are unavailable in exact mode'), true, 'exact matrix rejected');

// numeric calculus (float)
eq(resultOf({ expression: 'integrate(x^2, x, 0, 1)' }), '0.333333333333', 'integrate x^2');
eq(resultOf({ expression: 'integrate(x, x, 1, 0)' }), '-0.5', 'integrate reversed bounds');
eq(resultOf({ expression: 'integrate(x^2, x, 3, 3)' }), '0', 'integrate zero width');
eq(resultOf({ expression: 'integrate(a*x, x, 0, 1)', variables: { a: 2 } }), '1', 'integrate with variable');
eq(resultOf({ expression: 'integrate(sin(x), x, 0, pi)' }).startsWith('2'), true, 'integrate sin = 2');
eq(resultOf({ expression: 'integrate(1/x, x, 1, 2)' }).startsWith('0.69314718056'), true, 'integrate 1/x = ln2');
eq(resultOf({ expression: 'integrate(exp(-x^2), x, 0, 1)' }).startsWith('0.746824132812'), true, 'integrate gaussian');
eq(resultOf({ expression: 'integrate(sin(x)^2, x, 0, pi)' }).startsWith('1.57079632679'), true, 'integrate sin^2 = pi/2');
eq(resultOf({ expression: 'deriv(x^3, x, 2)' }), '12', 'deriv x^3 at 2');
eq(resultOf({ expression: 'deriv(x^2, x, 3)' }), '6', 'deriv x^2 at 3');
eq(resultOf({ expression: 'deriv(sin(x), x, 0)' }), '1', 'deriv sin at 0');
eq(resultOf({ expression: 'deriv(exp(x), x, 0)' }), '1', 'deriv exp at 0');
eq(resultOf({ expression: 'deriv(a*x^2, x, 2)', variables: { a: 3 } }), '12', 'deriv with variable');

// calculus errors
eq(resultOf({ expression: 'integrate(x^2, x, 0, inf)' }).startsWith('ERROR: integrate bounds must be finite'), true, 'integrate infinite bound');
eq(resultOf({ expression: 'integrate(1/x, x, -1, 1)' }).startsWith('ERROR:'), true, 'integrate singularity rejected');
eq(resultOf({ expression: 'integrate(x^2, 2, 0, 1)' }).startsWith("ERROR: integrate's 2nd argument must be a variable name"), true, 'integrate bad var');
eq(resultOf({ expression: 'integrate(x^2, x, 0)' }).startsWith('ERROR: integrate expects'), true, 'integrate arity');
eq(resultOf({ expression: 'deriv(x, x, 0, 1)' }).startsWith('ERROR: deriv expects'), true, 'deriv arity');
eq(resultOf({ expression: 'deriv(x^2, x, [1])' }).startsWith('ERROR: deriv point must be a finite number'), true, 'deriv matrix point');
eq(resultOf({ expression: 'integrate(sqrt(x), x, -1, 1)' }).startsWith('ERROR: sqrt of a negative'), true, 'integrand domain error propagates');
eq(resultOf({ expression: 'integrate(x, x, 0, 1)', precision: 'exact' }).startsWith("ERROR: function 'integrate' is unavailable"), true, 'exact integrate rejected');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
