const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  channelId: {
    type: String,
    required: true,
    unique: true,
  },
  messageId: {
    type: String,
    required: true,
  },
  fen: {
    type: String,
    required: true,
    default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  },
  gameType: {
    type: String,
    enum: ['pvp', 'pve'],
    required: true,
  },
  playerWhiteId: {
    type: String,
    required: true,
  },
  playerWhiteUsername: {
    type: String,
    required: true,
  },
  playerBlackId: {
    type: String,
    required: true,
  },
  playerBlackUsername: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Game', GameSchema);
