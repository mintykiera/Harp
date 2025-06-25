const fs = require('node:fs');
const path = require('node:path');

const infractionsPath = path.join(__dirname, 'infractions.json');

// Function to read the infractions file
function readInfractions() {
  try {
    // If the file doesn't exist, start with an empty object
    if (!fs.existsSync(infractionsPath)) {
      return {};
    }
    const data = fs.readFileSync(infractionsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading infractions file:', error);
    return {};
  }
}

// Function to write to the infractions file
function writeInfractions(data) {
  try {
    fs.writeFileSync(infractionsPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing to infractions file:', error);
  }
}

// Public functions that our commands will use
module.exports = {
  addInfraction: (userId, reason) => {
    const infractions = readInfractions();
    if (!infractions[userId]) {
      infractions[userId] = [];
    }
    infractions[userId].push({
      date: new Date().toISOString(),
      reason: reason,
    });
    writeInfractions(infractions);
    return infractions[userId].length; // Return the new count
  },

  getInfractions: (userId) => {
    const infractions = readInfractions();
    return infractions[userId] || [];
  },
};
