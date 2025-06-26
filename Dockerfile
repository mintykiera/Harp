# Start with the official Node.js slim image
FROM node:20-slim

# The 'tar' command is already included in this base image.

# Set the working directory
WORKDIR /usr/src/app

# Copy the Stockfish tar archive from our repository
COPY stockfish-ubuntu-x86-64-avx2.tar .

# Extract the archive, move the binary, make it executable, and clean up
RUN tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish_bin && \
  chmod +x stockfish_bin && \
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish

# Copy dependency files and install
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Start the application
CMD ["npm", "start"]