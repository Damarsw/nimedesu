FROM python:3.10-slim

# Menginstal dependensi sistem yang dibutuhkan oleh Chrome dan Selenium
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    gnupg \
    libxi6 \
    libgconf-2-4 \
    libnss3 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Menginstal Google Chrome terbaru
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Menentukan direktori kerja di dalam container
WORKDIR /app

# Menyalin file daftar pustaka Python dan menginstalnya
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Menyalin seluruh file kode dan database JSON Anda ke dalam container
COPY . .

# Membuka port server Flask untuk Render
EXPOSE 10000

# Menjalankan bot Python sekaligus server API
CMD ["python", "update.py"]
