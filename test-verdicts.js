// Checks that every verdict comes out right and that malicious code is contained.
// Run: node test-verdicts.js   (Piston must be running, MongoDB not needed)
const { evaluate } = require('./judge');

const TESTS = [
  { input: '2 3\n', output: '5\n' },
  { input: '10 -4\n', output: '6\n' }
];

const CASES = [
  // Normal verdicts - C++
  { name: 'C++ correct', lang: 'cpp', expect: ['AC'],
    code: '#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << std::endl; }' },
  { name: 'C++ wrong answer', lang: 'cpp', expect: ['WA'],
    code: '#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a - b << std::endl; }' },
  { name: 'C++ infinite loop', lang: 'cpp', expect: ['TLE'],
    code: 'int main() { volatile long long x = 0; while (true) x++; }' },
  { name: 'C++ crash', lang: 'cpp', expect: ['RE'],
    code: '#include <vector>\nint main() { std::vector<int> v; return v.at(5); }' },
  { name: 'C++ syntax error', lang: 'cpp', expect: ['CE'],
    code: 'int main() { return 0 }' },

  // Normal verdicts - Python
  { name: 'Python correct', lang: 'python', expect: ['AC'],
    code: 'a, b = map(int, input().split())\nprint(a + b)' },
  { name: 'Python wrong answer', lang: 'python', expect: ['WA'],
    code: 'a, b = map(int, input().split())\nprint(a * b)' },
  { name: 'Python infinite loop', lang: 'python', expect: ['TLE'],
    code: 'while True:\n    pass' },
  { name: 'Python divide by zero', lang: 'python', expect: ['RE'],
    code: 'print(1 // 0)' },
  { name: 'Python syntax error', lang: 'python', expect: ['CE'],
    code: 'print("hi"' },

  // Malicious code - must be contained, never AC, server must survive
  { name: 'Fork bomb', lang: 'python', expect: ['TLE', 'RE'],
    code: 'import os\nwhile True:\n    os.fork()' },
  { name: 'Infinite output flood', lang: 'python', expect: ['TLE', 'RE', 'WA'],
    code: 'while True:\n    print("x" * 1000)' },
  { name: 'Memory hog', lang: 'python', expect: ['TLE', 'RE'],
    code: 'a = []\nwhile True:\n    a.append(" " * 10**7)' },
  { name: 'Network access (must be blocked)', lang: 'python', expect: ['RE'],
    code: 'import urllib.request\nurllib.request.urlopen("http://example.com", timeout=3)\na, b = map(int, input().split())\nprint(a + b)' }
];

(async () => {
  let ok = 0;
  for (const c of CASES) {
    const start = Date.now();
    try {
      const r = await evaluate({ language: c.lang, code: c.code, tests: TESTS, timeLimit: 2, memoryLimit: 256 });
      const pass = c.expect.includes(r.status);
      if (pass) ok++;
      const note = r.message ? '  - ' + r.message.split('\n')[0].slice(0, 70) : '';
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(34)} got ${r.status.padEnd(4)} expected ${c.expect.join('/').padEnd(10)} ${Date.now() - start} ms${note}`);
    } catch (err) {
      console.log(`ERROR ${c.name}: ${err.message}`);
    }
  }
  console.log(`\n${ok}/${CASES.length} checks passed`);
})();