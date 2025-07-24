const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  channelId: {
    type: String,
    required: true,
    unique: true,
  },
  guildId: {
    type: String,
    required: true,
  },
  ticketId: {
    type: Number,
    required: true,
  },
  ticketType: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    required: true,
    default: 'open',
  },
  reportDetails: {
    location: { type: String },
    topic: { type: String },
    openingMessage: { type: String },
    description: { type: String },
  },
  created: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Ticket', ticketSchema);
