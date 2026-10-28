const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'participant'], default: 'participant' }
}, { timestamps: true });

const problemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  statement: { type: String, required: true },
  inputFormat: { type: String, default: '' },
  outputFormat: { type: String, default: '' },
  samples: [{ input: String, output: String, _id: false }],
  timeLimit: { type: Number, default: 2 },    // seconds
  memoryLimit: { type: Number, default: 256 }, // MB
  createdBy: { type: ObjectId, ref: 'User' }
}, { timestamps: true });

// Hidden tests live in their own collection so a normal "get problem" query can never leak them.
const testCaseSchema = new mongoose.Schema({
  problem: { type: ObjectId, ref: 'Problem', required: true, index: true },
  order: { type: Number, default: 0 },
  input: { type: String, default: '' },
  output: { type: String, default: '' }
});

const submissionSchema = new mongoose.Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  problem: { type: ObjectId, ref: 'Problem', required: true },
  language: { type: String, enum: ['cpp', 'python'], required: true },
  code: { type: String, required: true },
  status: {
    type: String,
    enum: ['queued', 'running', 'AC', 'WA', 'TLE', 'RE', 'CE', 'SE'],
    default: 'queued'
  },
  passed: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  failedTest: Number,
  timeMs: Number,
  message: String,
  startedAt: Date,
  judgedAt: Date
}, { timestamps: true });

submissionSchema.index({ status: 1, createdAt: 1 });
submissionSchema.index({ user: 1, problem: 1, createdAt: -1 });
submissionSchema.index({ problem: 1 });

module.exports = {
  User: mongoose.model('User', userSchema),
  Problem: mongoose.model('Problem', problemSchema),
  TestCase: mongoose.model('TestCase', testCaseSchema),
  Submission: mongoose.model('Submission', submissionSchema)
};