const mongoose = require('mongoose');

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
  history: [
    {
      role: String,
      parts: [{ text: String }],
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

GeminiSchema.index({ userId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('Gemini', GeminiSchema);
