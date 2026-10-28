// Judge queue: picks queued submissions one by one and judges a few in parallel.
const { Submission, Problem, TestCase } = require('./models');
const { evaluate, EngineDownError } = require('./judge');
const { MAX_PARALLEL } = require('./config');

let active = 0;
let busy = false;
let pausedUntil = 0;

async function judgeOne(sub) {
  try {
    const problem = await Problem.findById(sub.problem);
    if (!problem) {
      await Submission.updateOne({ _id: sub._id }, { status: 'SE', message: 'Problem was deleted', judgedAt: new Date() });
      return;
    }
    const tests = await TestCase.find({ problem: problem._id }).sort({ order: 1 }).lean();
    if (!tests.length) {
      await Submission.updateOne({ _id: sub._id }, { status: 'SE', message: 'This problem has no hidden tests yet', judgedAt: new Date() });
      return;
    }

    const result = await evaluate({
      language: sub.language,
      code: sub.code,
      tests,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit
    });

    await Submission.updateOne({ _id: sub._id }, { ...result, judgedAt: new Date() });
    console.log(`Judged ${sub._id}: ${result.status}`);
  } catch (err) {
    if (err instanceof EngineDownError) {
      // Judge laptop is off or Docker stopped: put it back in the queue, try again in 5s.
      console.warn('Judge engine unreachable, retrying in 5s');
      pausedUntil = Date.now() + 5000;
      await Submission.updateOne({ _id: sub._id }, { status: 'queued' });
    } else {
      console.error('Judge error:', err.message);
      await Submission.updateOne({ _id: sub._id }, { status: 'SE', message: 'Judge error. Please contact faculty.', judgedAt: new Date() });
    }
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    while (active < MAX_PARALLEL && Date.now() >= pausedUntil) {
      // Atomic claim: two workers can never grab the same submission.
      const sub = await Submission.findOneAndUpdate(
        { status: 'queued' },
        { $set: { status: 'running', startedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true }
      );
      if (!sub) break;
      active++;
      judgeOne(sub).finally(() => { active--; });
    }
  } catch (err) {
    console.error('Queue error:', err.message);
  } finally {
    busy = false;
  }
}

async function startWorker() {
  // If the server crashed mid-judging, those submissions go back to the queue.
  const reset = await Submission.updateMany({ status: 'running' }, { $set: { status: 'queued' } });
  if (reset.modifiedCount) console.log(`Re-queued ${reset.modifiedCount} unfinished submissions`);
  setInterval(tick, 500);
  console.log(`Judge worker started (max ${MAX_PARALLEL} at a time)`);
}

module.exports = { startWorker };