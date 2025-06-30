FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN tar -xf stockfish-ubuntu-x86-64-avx2.tar && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish_bin && \
  chmod +x stockfish_bin && \
  rm stockfish-ubuntu-x86-64-avx2.tar && \
  rm -rf stockfish

CMD ["npm", "run", "start"]