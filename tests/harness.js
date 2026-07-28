/* Minimal assertion harness. No dependencies — these tests have to run
   from a plain static server on the same origin as the app. */

export const results = [];
let currentSuite = '';

export function resetResults() { results.length = 0; }

export function suite(name) { currentSuite = name; }

export function test(name, fn) {
  try {
    fn();
    results.push({ suite: currentSuite, name, ok: true });
  } catch (err) {
    results.push({ suite: currentSuite, name, ok: false, msg: err.message });
  }
}

export function eq(actual, expected, note = '') {
  if (actual !== expected) {
    throw new Error(`${note}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function near(actual, expected, tol = 0.001, note = '') {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
    throw new Error(`${note}expected ~${expected}, got ${JSON.stringify(actual)}`);
  }
}

export function throws(fn, note = '') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`${note}expected a throw, got none`);
}

export function includes(haystack, needle, note = '') {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${note}expected output to contain ${JSON.stringify(needle)}`);
  }
}

export function notIncludes(haystack, needle, note = '') {
  if (String(haystack).includes(needle)) {
    throw new Error(`${note}expected output NOT to contain ${JSON.stringify(needle)}`);
  }
}

export function match(value, regex, note = '') {
  if (!regex.test(String(value))) {
    throw new Error(`${note}expected ${JSON.stringify(String(value).slice(0, 120))} to match ${regex}`);
  }
}
