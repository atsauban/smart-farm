# Smart Farm Dashboard

Proyek ini adalah sebuah dashboard web untuk memonitoring dan mengontrol sistem "Smart Farm" berbasis IoT. Aplikasi ini terdiri dari dua bagian utama: server backend dan aplikasi web frontend.

## Fitur

*   **Real-time Monitoring:** Menampilkan data sensor (suhu, kelembapan udara, kelembapan tanah, dan intensitas cahaya) secara real-time menggunakan WebSockets.
*   **Kontrol Perangkat:** Mengirim perintah untuk mengontrol perangkat (misalnya, pompa air) melalui MQTT.
*   **Mode Otomatis & Manual:** Atur perangkat untuk berjalan otomatis berdasarkan ambang batas sensor, atau kendalikan secara manual.
*   **Visualisasi Data:** Grafik interaktif untuk menampilkan riwayat data sensor.
*   **Antarmuka Responsif:** Dibuat dengan Next.js dan Tailwind CSS untuk pengalaman terbaik di berbagai perangkat.

## Teknologi yang Digunakan

**Backend (Server):**
*   Node.js
*   Express.js
*   Socket.IO (untuk komunikasi real-time dengan frontend)
*   MQTT.js (untuk komunikasi dengan perangkat IoT)
*   dotenv (untuk manajemen environment variables)

**Frontend (Web):**
*   Next.js (React Framework)
*   TypeScript
*   Tailwind CSS
*   Recharts (untuk grafik)
*   Socket.IO Client
*   Lucide React (untuk ikon)

## Struktur Folder

```
smart-farm/
├── server/         # Backend Node.js
│   ├── server.js   # File utama server
│   ├── simulator.js# Skrip untuk simulasi data sensor
│   └── package.json
└── web/            # Frontend Next.js
    ├── app/        # Halaman dan layout utama
    ├── components/ # Komponen UI React
    ├── lib/        # Utilitas dan konfigurasi
    └── package.json
```

## Cara Menjalankan Proyek

### 1. Menjalankan Server Backend

```bash
# Masuk ke direktori server
cd smart-farm/server

# Install dependencies
npm install

# Jalankan server dalam mode development (dengan auto-reload)
npm run dev

# Atau jalankan server dalam mode produksi
npm run start

# Untuk menjalankan simulator (mengirim data sensor palsu)
npm run sim
```
Server akan berjalan di `http://localhost:3001`.

### 2. Menjalankan Frontend Web

```bash
# Masuk ke direktori web
cd smart-farm/web

# Install dependencies
npm install

# Jalankan server development Next.js
npm run dev
```
Aplikasi web akan dapat diakses di `http://localhost:3000`.
