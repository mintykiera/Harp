const mongoose = require('mongoose');

const HistoryPartSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, 'The text content of a history part is required.'],
    },
  },
  { _id: false }
);

const HistoryEntrySchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: [
        true,
        'The role (`user` or `model`) is required for each history entry.',
      ],
      enum: ['user', 'model'],
    },
    parts: {
      type: [HistoryPartSchema],
      required: true,
    },
  },
  { _id: false }
);

const GeminiSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  channelId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  history: {
    type: [HistoryEntrySchema],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '7d',
  },
});

GeminiSchema.index({ userId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('Gemini', GeminiSchema);
