FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential libcairo2-dev pkg-config && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-server.txt .
RUN pip install -r requirements-server.txt

# Pre-download the rembg model at build time so the first request doesn't timeout
RUN python -c "from rembg import new_session; new_session('u2net_human_seg')"

COPY . .

EXPOSE 8080

CMD ["python", "server.py"]
