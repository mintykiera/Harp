const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  channelId: {
    type: String,
    required: true,
    unique: true, // Excellent: Enforces one game per channel at the DB level.
  },
  messageId: {
    type: String,
    required: true,
    default: 'pending',
  },
  fen: {
    type: String,
    required: true,
    default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  },
  gameType: {
    type: String,
    enum: ['pvp', 'pve'], // Excellent: Ensures data integrity.
    required: true,
  },
  playerWhiteId: {
    type: String,
    required: true,
    index: true, // CORRECTED: Added for faster lookups.
  },
  playerWhiteUsername: {
    type: String,
    required: true,
  },
  playerBlackId: {
    type: String,
    required: true,
    index: true, // CORRECTED: Added for faster lookups.
  },
  playerBlackUsername: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '4h', // OPTIONAL: Automatically deletes game documents after 4 hours.
  },
});

module.exports = mongoose.model('Game', GameSchema);
