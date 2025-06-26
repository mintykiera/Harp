# --- Stage 1: The "Builder" ---
# This stage will clone the repo and download the LFS files.
FROM node:20-slim AS builder

# Install our needed system packages
RUN apt-get update && apt-get install -y git git-lfs

# Set the working directory
WORKDIR /app

# Clone the public repository into the current directory (.)
RUN git clone https://github.com/mintykiera/MMKV.git .

# Now that we are in a proper git repo, pull the LFS files
RUN git lfs pull

# Install npm dependencies
RUN npm install

# --- Stage 2: The Final Application ---
# This stage builds the lean, final image for running the bot.
FROM node:20-slim

WORKDIR /usr/src/app

# Copy the package files from the builder stage
COPY --from=builder /app/package*.json ./

# Install ONLY production dependencies to keep the image small
RUN npm install --omit=dev

# Copy the rest of the application code AND the now-downloaded LFS files
COPY --from=builder /app .

# Re-apply the execute permission, just to be safe
RUN chmod +x stockfish

# Set the command to start the bot
CMD ["npm", "start"]