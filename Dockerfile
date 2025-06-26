# Start with the official Node.js slim image
FROM node:20-slim

# The 'tar' command is already included in this base image.

# Set the working directory
WORKDIR /usr/src/app

# Copy the Stockfish tar archive from our repository
# --- CHANGE: Updated filename to match yours ---
COPY stockfish-ubuntu-x86-64-avx2.tar .

# Extract the archive, rename the binary, make it executable, and clean up
# --- CHANGE: Removed the 'z' from 'tar -xzf' because it's not a .gz file ---
RUN tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  # The binary is inside a folder named 'stockfish' after extracting
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish && \
  chmod +x stockfish && \
  # Clean up the downloaded tar and the now-empty folder
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish

# Copy dependency files and install
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Start the application
CMD ["npm", "start"]