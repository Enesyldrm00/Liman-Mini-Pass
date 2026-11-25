# Liman — Notlar

Faz özetleri ve mülakat hazırlığı. Alt bölüm notları önce "Taslak notlar" altında birikir, faz sonunda (`/faz-kapat`) faz bölümüne işlenir.

## Taslak notlar

### 0.4 Veritabanı

- Bölüm 7'deki 9 tablo `packages/db` paketinde Drizzle ile yazıldı. Paket yalnızca api ve worker için; panel `pg`'yi görmüyor. Tek migration var (`0000_init.sql`), compose'daki `migrate` servisi bunu uyguluyor (ADR-0018).
- "Uygulama başına tek aktif deployment" kuralını kod değil, kısmi unique index sağlıyor: `UNIQUE (app_id) WHERE status = 'active'`. Eşzamanlılık testi bunu doğruluyor: iki transaction aynı anda `active` eklerse ikincisi birincinin commit'ini bekliyor ve sonra `23505` hatası alıyor. Geçişte önce eski deployment `superseded` yapılmalı, sonra yenisi `active`; ikisi aynı transaction'da.
- Durum alanları enum değil, `text` + `CHECK`. Değerler `@liman/shared` sabitlerinden geliyor. Ayrıca bazı biçimleri DB kendisi zorluyor: `token_hash` hex SHA-256 olmalı, `value_enc` `v1:` önekiyle başlamalı, `image_ref` digest içermeli. Deployment'lar bileşik FK ile yalnızca kendi uygulamasının build'ine bağlanabiliyor.
- **Kırılgan noktalar:**
  - Sabit listesi değişip `generate` çalıştırılmazsa TypeScript ile DB birbirinden kopar.
  - `$onUpdate` yalnızca Drizzle üzerinden yapılan güncellemelerde çalışır.
  - RESTRICT ihlali `23503` değil `23001` koduyla döner.
  - Faz 1'de claim, `heartbeat_at` alanını hemen set etmeli; yoksa reaper o build'i göremez.
  - `pnpm test` artık Docker istiyor (Testcontainers).
