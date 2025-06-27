const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    required: true,
  },
  elo: {
    type: Number,
    default: 1200,
  },
  stats: {
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
  },
  searchHistory: [
    {
      query: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  // --- NEW FIELD ADDED HERE ---
  recentGames: [
    {
      opponentId: String,
      opponentUsername: String,
      result: { type: String, enum: ['win', 'loss', 'draw'] },
      eloChange: Number,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

module.exports = mongoose.model('User', UserSchema);
