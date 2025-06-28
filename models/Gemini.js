const mongoose = require('mongoose');

// Define the schema for a 'part' within a history entry
const HistoryPartSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    // Add other part types if needed in the future (e.g., inline_data, file_data)
  },
  { _id: false }
); // <-- CRITICAL: Disable _id for parts subdocuments

// Define the schema for a 'history' entry (role + parts)
const HistoryEntrySchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    parts: [HistoryPartSchema], // Use the named schema here
  },
  { _id: false }
); // <-- CRITICAL: Disable _id for history entry subdocuments

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
  history: [HistoryEntrySchema], // Use the named schema for the array
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

GeminiSchema.index({ userId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('Gemini', GeminiSchema);
