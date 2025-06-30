FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Use AVX2 compatible Stockfish version
RUN if [ -f stockfish-ubuntu-x86-64-avx2.tar ]; then \
  tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish_bin && \
  chmod +x stockfish_bin && \
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish; \
  elif [ -f stockfish.exe ]; then \
  chmod +x stockfish.exe; \
  fi

# Health check for Render
HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:$PORT/health || exit 1

CMD ["npm", "run", "start"]