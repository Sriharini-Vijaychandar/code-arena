// Talks to the Piston sandbox and turns its results into AC / WA / TLE / RE / CE.
// User code NEVER runs on this server - only inside Piston's sandbox.
const { PISTON_URL } = require('./config');

const LANGUAGES = {
  cpp: { piston: 'c++', file: 'main.cpp', label: 'C++' },
  python: { piston: 'python', file: 'main.py', label: 'Python 3' }
};

class EngineDownError extends Error {}

// Python has no compile step, so we check syntax first to report CE instead of RE.
const PY_SYNTAX_CHECKER = [
  'import sys',
  "src = open('main.py', encoding='utf-8').read()",
  'try:',
  "    compile(src, 'main.py', 'exec')",
  'except SyntaxError as e:',
  "    print(f'Line {e.lineno}: {type(e).__name__}: {e.msg}')",
  '    sys.exit(3)'
].join('\n');

function clip(text, max = 2000) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '\n...(truncated)' : s;
}

// Ignore trailing spaces on each line and trailing blank lines. Everything else must match.
function normalize(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

async function pistonExecute(language, files, stdin, timeLimitSec, memoryMB) {
  const body = {
    language: LANGUAGES[language].piston,
    version: '*',
    files,
    stdin: stdin || '',
    compile_timeout: 10000,
    run_timeout: Math.round(timeLimitSec * 1000),
    run_memory_limit: memoryMB * 1024 * 1024
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(PISTON_URL + '/api/v2/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    throw new EngineDownError('Cannot reach the judge engine: ' + err.message);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    throw new Error(`Judge engine error ${res.status}: ${data.message || text.slice(0, 300) || 'no details'}`);
  }
  return data;
}

function isTimeout(run, limitMs) {
  if (run.status === 'TO') return true;                    // newer Piston
  if (!run.status && run.signal === 'SIGKILL') return true; // older Piston kills on timeout
  return typeof run.wall_time === 'number' && run.wall_time > limitMs;
}

// We never show stderr to students: a program could print hidden test input to stderr.
function runtimeMessage(run) {
  if (run.signal) return 'Program was killed (' + run.signal + ')';
  return 'Program exited with code ' + run.code;
}

async function evaluate({ language, code, tests, timeLimit, memoryLimit }) {
  const total = tests.length;
  const limitMs = Math.round(timeLimit * 1000);
  const file = { name: LANGUAGES[language].file, content: code };

  if (language === 'python') {
    let check = null;
    try {
      check = await pistonExecute('python', [{ name: 'check.py', content: PY_SYNTAX_CHECKER }, file], '', 3, 256);
    } catch (err) {
      if (err instanceof EngineDownError) throw err;
      console.warn('Python syntax check skipped:', err.message); // judge the code normally instead
    }
    if (check && check.run && check.run.code === 3) {
      return { status: 'CE', passed: 0, total, message: clip(check.run.stdout) };
    }
  }

  let maxTime = 0;
  for (let i = 0; i < total; i++) {
    const result = await pistonExecute(language, [file], tests[i].input, timeLimit, memoryLimit);

    if (result.compile && (result.compile.code !== 0 || result.compile.signal)) {
      return {
        status: 'CE', passed: 0, total,
        message: clip(result.compile.stderr || result.compile.output || 'Compilation failed')
      };
    }

    const run = result.run || {};
    if (typeof run.wall_time === 'number') maxTime = Math.max(maxTime, run.wall_time);

    if (isTimeout(run, limitMs)) {
      return { status: 'TLE', failedTest: i + 1, passed: i, total, timeMs: limitMs };
    }
    if (run.code !== 0 || run.signal) {
      return { status: 'RE', failedTest: i + 1, passed: i, total, timeMs: maxTime, message: runtimeMessage(run) };
    }
    if (normalize(run.stdout) !== normalize(tests[i].output)) {
      return { status: 'WA', failedTest: i + 1, passed: i, total, timeMs: maxTime };
    }
  }

  return { status: 'AC', passed: total, total, timeMs: maxTime };
}

module.exports = { LANGUAGES, EngineDownError, evaluate, normalize };