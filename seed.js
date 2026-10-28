// Creates the faculty account and two demo problems. Safe to run more than once.
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { User, Problem, TestCase } = require('./models');

const FACULTY = [
  { name: 'Faculty Admin', email: 'faculty@rvce.edu.in', password: 'faculty123' }
];

const bigN = 100000;
const bigInput = bigN + '\n' + Array.from({ length: bigN }, (_, i) => i + 1).join(' ') + '\n';

const PROBLEMS = [
  {
    title: 'Sum of Two Numbers',
    statement: 'Given two integers A and B, print their sum.',
    inputFormat: 'One line with two integers A and B (-10^9 <= A, B <= 10^9).',
    outputFormat: 'Print A + B.',
    timeLimit: 2,
    memoryLimit: 256,
    samples: [{ input: '2 3\n', output: '5\n' }],
    tests: [
      { input: '2 3\n', output: '5\n' },
      { input: '-4 10\n', output: '6\n' },
      { input: '1000000000 1000000000\n', output: '2000000000\n' },
      { input: '0 0\n', output: '0\n' }
    ]
  },
  {
    title: 'Count Even Numbers',
    statement: 'Given N integers, print how many of them are even.',
    inputFormat: 'The first line has N (1 <= N <= 10^5).\nThe second line has N integers.',
    outputFormat: 'Print the number of even integers.',
    timeLimit: 2,
    memoryLimit: 256,
    samples: [{ input: '5\n1 2 3 4 6\n', output: '3\n' }],
    tests: [
      { input: '5\n1 2 3 4 6\n', output: '3\n' },
      { input: '3\n1 3 5\n', output: '0\n' },
      { input: '4\n-2 -1 0 7\n', output: '2\n' },
      { input: bigInput, output: '50000\n' }
    ]
  }
];

(async () => {
  await mongoose.connect(config.MONGO_URL);

  for (const f of FACULTY) {
    const exists = await User.findOne({ email: f.email });
    if (exists) {
      console.log(`Faculty ${f.email} already exists`);
    } else {
      await User.create({ name: f.name, email: f.email, passwordHash: await bcrypt.hash(f.password, 10), role: 'admin' });
      console.log(`Created faculty ${f.email} / ${f.password}`);
    }
  }

  if (await Problem.countDocuments() === 0) {
    const admin = await User.findOne({ role: 'admin' });
    for (const p of PROBLEMS) {
      const { tests, ...data } = p;
      const problem = await Problem.create({ ...data, createdBy: admin._id });
      await TestCase.insertMany(tests.map((t, i) => ({ problem: problem._id, order: i + 1, ...t })));
      console.log(`Created problem "${p.title}" with ${tests.length} hidden tests`);
    }
  } else {
    console.log('Problems already exist, skipping demo problems');
  }

  await mongoose.disconnect();
  console.log('Seed done');
})().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});