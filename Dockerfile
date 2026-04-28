FROM python:3.11-slim

# Install system deps + Node.js 20 (needed to build the Vite frontend)
RUN apt-get update && apt-get install -y \
    build-essential libcairo2-dev pkg-config curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements-server.txt .
RUN pip install -r requirements-server.txt

# Node dependencies
COPY package*.json ./
RUN npm ci

# Copy everything and build the Vite frontend
# VITE_API_URL is intentionally left unset so all /api calls use relative URLs
# (same origin — Flask serves both the frontend and the API)
COPY . .
RUN npm run build

EXPOSE 8080

CMD ["python", "server.py"]
