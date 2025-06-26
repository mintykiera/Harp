# Start with the official Node.js slim image
FROM node:20-slim

# Set the working directory
WORKDIR /usr/src/app

# Copy dependency files and install
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Extract Stockfish binary from tar
RUN tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish_bin && \
  chmod +x stockfish_bin && \
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish

# Start the application
CMD ["npm", "start"]
