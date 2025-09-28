# WebGIS Sengketa & Potensi Masalah — Tarakan

## Cara Menjalankan
1. Ekstrak semua file (`index.html`, `style.css`, `app.js`) ke satu folder.
2. **Cara cepat**: klik dua kali `index.html` → terbuka di browser.
3. **Disarankan**: jalankan server lokal supaya impor KMZ/SHP lebih stabil:
   ```bash
   python -m http.server 8080
   ```
   lalu buka `http://localhost:8080/` di browser.

## Fitur
- Peta Leaflet + Leaflet Draw (gambar titik, garis, poligon)
- Impor GeoJSON, KML, KMZ, SHP (ZIP)
- Filter status/severity, label NIB
- Editor atribut & skema tipe data
- Rekap per kelurahan (tabel + grafik Chart.js)
- Ekspor GeoJSON, KML, CSV

## Deploy Online
- **GitHub Pages**: push file ke repo, aktifkan Pages.
- **Netlify/Vercel/Cloudflare Pages**: drag & drop folder hasil ekstrak.

