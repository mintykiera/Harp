# Start with the official Node.js slim image
FROM node:20-slim

# Install unzip only (no recommended extras), then clean up
RUN apt-get update && \
  apt-get install -y --no-install-recommends unzip && \
  rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /usr/src/app

# Copy the Stockfish zip file into the image
COPY stockfish-linux.zip .

# Unzip the file, rename the binary to `stockfish`, make it executable, clean up
RUN unzip -q stockfish-linux.zip && \
  mv $(find . -type f -name "stockfish*" -perm /111 | head -n 1) stockfish && \
  chmod +x stockfish && \
  rm stockfish-linux.zip

# Copy dependency files and install
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Start the application
CMD ["npm", "start"]
