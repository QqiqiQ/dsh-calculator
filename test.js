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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
