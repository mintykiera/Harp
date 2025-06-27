# Start with the official Node.js slim image for a smaller base
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files first to leverage Docker's layer caching
COPY package*.json ./

# --- THE KEY CHANGE ---
# Install *only* production dependencies. Skip devDependencies like nodemon.
# This dramatically reduces the size of node_modules and the build cache.
RUN npm install --omit=dev

# Copy the rest of your application source code
COPY . .

# Extract the Stockfish binary and set permissions
RUN tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish_bin && \
  chmod +x stockfish_bin && \
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish

# Define the command to start the application
CMD ["npm", "start"]