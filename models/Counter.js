const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  // _id will be a string like 'ticketCounter' to identify which counter this is
  _id: { type: String, required: true },
  // seq will be the number that increments
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', CounterSchema);
