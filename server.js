// CodeArena - main server
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { User, Problem, TestCase, Submission } = require('./models');
const { LANGUAGES } = require('./judge');
const { startWorker } = require('./worker');

// The judge engine rejects requests over ~100 KB, and each request carries code + one test's input.
const MAX_TEST_INPUT_BYTES = 60 * 1024;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isId = (id) => mongoose.isValidObjectId(id);

function publicUser(u) {
  return { id: u._id, name: u.name, email: u.email, role: u.role };
}

function signToken(u) {
  return jwt.sign({ id: String(u._id) }, config.JWT_SECRET, { expiresIn: '7d' });
}

const auth = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }

  const user = await User.findById(payload.id).select('-passwordHash');
  if (!user) return res.status(401).json({ error: 'Account not found' });
  req.user = user;
  next();
});

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Faculty only' });
  next();
}

function cleanCases(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(c => c && typeof c.input === 'string' && typeof c.output === 'string' && c.output.trim() !== '')
    .map(c => ({ input: c.input, output: c.output }));
}

/* ---------------- Auth ---------------- */

app.post('/api/register', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!email.endsWith(config.EMAIL_DOMAIN)) return res.status(400).json({ error: `Use your ${config.EMAIL_DOMAIN} email` });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role: 'participant' });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

/* ---------------- Problems ---------------- */

app.get('/api/problems', auth, wrap(async (req, res) => {
  const problems = await Problem.find().sort({ createdAt: 1 }).select('title timeLimit memoryLimit createdAt').lean();
  const solvedIds = await Submission.distinct('problem', { user: req.user._id, status: 'AC' });
  const solved = new Set(solvedIds.map(String));

  let testCounts = {};
  if (req.user.role === 'admin') {
    const counts = await TestCase.aggregate([{ $group: { _id: '$problem', n: { $sum: 1 } } }]);
    counts.forEach(c => { testCounts[String(c._id)] = c.n; });
  }

  res.json(problems.map(p => ({
    ...p,
    solved: solved.has(String(p._id)),
    testCount: req.user.role === 'admin' ? (testCounts[String(p._id)] || 0) : undefined
  })));
}));

app.get('/api/problems/:id', auth, wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Problem not found' });
  const problem = await Problem.findById(req.params.id).lean();
  if (!problem) return res.status(404).json({ error: 'Problem not found' });
  if (req.user.role === 'admin') problem.testCount = await TestCase.countDocuments({ problem: problem._id });
  res.json(problem); // hidden tests are in a different collection, never sent
}));

app.post('/api/problems', auth, adminOnly, wrap(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const statement = String(req.body.statement || '').trim();
  const inputFormat = String(req.body.inputFormat || '').trim();
  const outputFormat = String(req.body.outputFormat || '').trim();
  const samples = cleanCases(req.body.samples);
  const tests = cleanCases(req.body.tests);
  const timeLimit = Number(req.body.timeLimit) || 2;
  const memoryLimit = Number(req.body.memoryLimit) || 256;

  if (!title || !statement) return res.status(400).json({ error: 'Title and statement are required' });
  if (!tests.length) return res.status(400).json({ error: 'Add at least one hidden test' });
  if (timeLimit < 0.5 || timeLimit > config.MAX_TIME_LIMIT) return res.status(400).json({ error: `Time limit must be 0.5 to ${config.MAX_TIME_LIMIT} seconds` });
  if (memoryLimit < 32 || memoryLimit > 1024) return res.status(400).json({ error: 'Memory limit must be 32 to 1024 MB' });
  const bigTest = tests.findIndex(t => Buffer.byteLength(t.input, 'utf8') > MAX_TEST_INPUT_BYTES);
  if (bigTest !== -1) return res.status(400).json({ error: `Test ${bigTest + 1} input is too large (max 60 KB per test)` });

  const problem = await Problem.create({
    title, statement, inputFormat, outputFormat, samples, timeLimit, memoryLimit, createdBy: req.user._id
  });
  await TestCase.insertMany(tests.map((t, i) => ({ problem: problem._id, order: i + 1, input: t.input, output: t.output })));
  res.status(201).json(problem);
}));

app.delete('/api/problems/:id', auth, adminOnly, wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Problem not found' });
  await Problem.deleteOne({ _id: req.params.id });
  await TestCase.deleteMany({ problem: req.params.id });
  await Submission.deleteMany({ problem: req.params.id });
  res.json({ ok: true });
}));

/* ---------------- Submissions ---------------- */

app.post('/api/submissions', auth, wrap(async (req, res) => {
  const { problemId, language, code } = req.body;

  if (!isId(problemId) || !(await Problem.exists({ _id: problemId }))) return res.status(404).json({ error: 'Problem not found' });
  if (!LANGUAGES[language]) return res.status(400).json({ error: 'Language must be C++ or Python' });
  if (typeof code !== 'string' || !code.trim()) return res.status(400).json({ error: 'Your code is empty' });
  if (Buffer.byteLength(code, 'utf8') > config.MAX_CODE_BYTES) return res.status(400).json({ error: 'Code is too long (max 64 KB)' });

  const pending = await Submission.exists({ user: req.user._id, status: { $in: ['queued', 'running'] } });
  if (pending) return res.status(429).json({ error: 'Wait for your previous submission to finish' });

  if (req.user.role !== 'admin') {
    const last = await Submission.findOne({ user: req.user._id }).sort({ createdAt: -1 }).select('createdAt');
    const waited = last ? Date.now() - last.createdAt.getTime() : Infinity;
    if (waited < config.SUBMIT_COOLDOWN_MS) {
      const secs = Math.ceil((config.SUBMIT_COOLDOWN_MS - waited) / 1000);
      return res.status(429).json({ error: `Please wait ${secs}s before submitting again` });
    }
  }

  const sub = await Submission.create({ user: req.user._id, problem: problemId, language, code });
  res.status(201).json({ id: sub._id });
}));

app.get('/api/submissions', auth, wrap(async (req, res) => {
  const filter = {};
  if (req.user.role !== 'admin' || req.query.scope !== 'all') filter.user = req.user._id;
  if (req.query.problemId && isId(req.query.problemId)) filter.problem = req.query.problemId;

  const subs = await Submission.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .select('-code')
    .populate('problem', 'title')
    .populate('user', 'name')
    .lean();
  res.json(subs);
}));

app.get('/api/submissions/:id', auth, wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Submission not found' });
  const sub = await Submission.findById(req.params.id).populate('problem', 'title').populate('user', 'name').lean();
  const ownerId = sub && sub.user ? String(sub.user._id) : null;
  // Students can only see their own code
  if (!sub || (req.user.role !== 'admin' && ownerId !== String(req.user._id))) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  let queuePosition = null;
  if (sub.status === 'queued') {
    queuePosition = await Submission.countDocuments({ status: 'queued', createdAt: { $lte: sub.createdAt } });
  }
  res.json({ ...sub, queuePosition });
}));

/* ---------------- Leaderboard ---------------- */

app.get('/api/leaderboard', auth, wrap(async (req, res) => {
  const students = await User.find({ role: 'participant' }).select('name').lean();
  // CE and judge errors don't count as wrong attempts
  const subs = await Submission.find({ status: { $in: ['AC', 'WA', 'TLE', 'RE'] } })
    .sort({ createdAt: 1 })
    .select('user problem status createdAt')
    .lean();

  const stats = new Map();
  for (const s of subs) {
    const uid = String(s.user);
    if (!stats.has(uid)) stats.set(uid, { solved: 0, wrong: 0, lastAc: null, problems: new Map() });
    const st = stats.get(uid);
    const pid = String(s.problem);
    if (!st.problems.has(pid)) st.problems.set(pid, { solved: false, wrong: 0 });
    const p = st.problems.get(pid);
    if (p.solved) continue;
    if (s.status === 'AC') {
      p.solved = true;
      st.solved++;
      st.wrong += p.wrong; // wrong attempts only count on problems you eventually solved
      st.lastAc = s.createdAt;
    } else {
      p.wrong++;
    }
  }

  const time = (d) => (d ? new Date(d).getTime() : Infinity);
  const rows = students.map(u => {
    const st = stats.get(String(u._id)) || { solved: 0, wrong: 0, lastAc: null };
    return {
      name: u.name,
      solved: st.solved,
      wrongAttempts: st.wrong,
      lastAc: st.lastAc,
      isMe: String(u._id) === String(req.user._id)
    };
  });

  rows.sort((a, b) =>
    b.solved - a.solved ||
    a.wrongAttempts - b.wrongAttempts ||
    time(a.lastAc) - time(b.lastAc) ||
    a.name.localeCompare(b.name)
  );
  rows.forEach((r, i) => { r.rank = i + 1; });
  res.json(rows);
}));

/* ---------------- Judge engine status (faculty) ---------------- */

app.get('/api/judge-status', auth, adminOnly, wrap(async (req, res) => {
  try {
    const r = await fetch(config.PISTON_URL + '/api/v2/runtimes', { signal: AbortSignal.timeout(3000) });
    const list = await r.json();
    const wanted = list.filter(x => x.language === 'python' || x.language === 'c++');
    res.json({ online: true, runtimes: wanted.map(x => `${x.language} ${x.version}`) });
  } catch {
    res.json({ online: false, runtimes: [] });
  }
}));

/* ---------------- Errors ---------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

/* ---------------- Start ---------------- */

mongoose.connect(config.MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB');
    await startWorker();
    app.listen(config.PORT, () => console.log(`CodeArena running at http://127.0.0.1:${config.PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });