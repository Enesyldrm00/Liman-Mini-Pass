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

### 0.5 Yapılandırma ve loglama

- api ve worker açılışta env'i Zod ile doğruluyor (`apps/*/src/config`). Yapı taşları (`parseEnv`, `originSchema`, `portSchema`…) tarayıcıda da çalışabilsin diye `@liman/shared`'da. Hatalı ya da eksik bir değer varsa süreç dinlemeye başlamadan `exit 1` ile kapanıyor. Mesajda yalnızca değişken adı ve sorun yazıyor, değer asla yazmıyor (parola içerebilir). Boş string eksik sayılıyor. Şimdilik yalnızca bağlantı ayarları zorunlu; GitHub ve şifreleme değişkenleri kullanıldıkları alt bölümde şemaya girecek.
- api Express 5'e geçti. pino JSON log basıyor, pino-http her isteğe bir kimlik veriyor ve bu kimlik cevapta `X-Request-Id`, `req.log` satırlarında `reqId` olarak görünüyor. Gelen bir kimlik yalnızca `[A-Za-z0-9._-]{1,64}` biçimindeyse kullanılıyor, böylece log enjeksiyonu yapılamıyor. Bir istemcinin başka bir kimliği taklit edip eşleştirmeyi bulandırması kabul edilen risk.
- Gizleme: `authorization`, `proxy-authorization`, `cookie`, `set-cookie` ve `x-hub-signature(-256)` başlıkları iki iç seviyeye kadar `[redacted]` yapılıyor (`@liman/shared/log-redaction`). Sorgu dizesi hiç loglanmıyor, çünkü 0.7'de OAuth `code` ve `state` orada olacak.
- **Kırılgan noktalar:**
  - Redaction yol tabanlı çalışıyor. Bilinmeyen bir alana (ör. `{ token }`) yazılan sır maskelenmez, o yüzden loga nesneyi bütün olarak değil, seçilmiş alanlarını koy.
  - Uygulanmış bir migration dosyası sonradan değişirse Drizzle onu yeni bir migration sanıyor ve eski volume'da `migrate` kırılıyor. 0.4'ten kalan bir volume'da bu oldu. Kural: bir migration uygulandıysa düzenlenmez, değişiklik yeni bir migration olarak eklenir.
  - Startup testleri `tsx` ile gerçek süreç başlatıyor; yavaş bir makinede 20 saniyelik zaman aşımına takılabilir.

### 0.6 GitHub App

- Geliştirme App'i `liman-dev-06` (`liman-dev` adı GitHub'da alınmıştı; App adları global). Yetkiler yalnızca Contents ve Metadata read, abone olunan tek olay `push`; `installation` ve `installation_repositories` her App'e zaten geliyor. Adımlar `docs/github-app-setup.md`'de. App manifest akışıyla oluşturuldu ve App JWT ile doğrulandı: `ping` ve `installation.created` smee'ye 200 ile ulaştı.
- "Request user authorization during installation" bilinçli olarak kapalı. Açık olsaydı GitHub Setup URL'yi devre dışı bırakıp kullanıcıyı callback'e gönderirdi; 0.8'de gelen `installation_id`'yi doğrulamak için setup dönüşü gerekiyor.
- smee istemcisi (forwarder) 1.2'ye ertelendi (seçenek A): hedef uç yokken her teslimat 404 alırdı. Bu alt bölümde yalnızca kanal açıldı ve App'e bağlandı. Kimlik bilgileri `.env` ve `secrets/app.pem`'de, ikisi de git-ignored.
- **Kırılgan noktalar:**
  - smee kanal sayfası gövdeyi imzasıyla birlikte gösteriyor. HMAC tekrar oynatmayı engellemez ve `X-GitHub-Delivery` imzanın kapsamında değil. Commit bazlı idempotency park alanına eklendi; 1.2'de karar verilecek.
  - 0.8 açık sorusu: `installation_id` doğrulaması `GET /user/installations` ile yapılırsa user token gerekir (saklamıyoruz). Alternatif: App JWT ile `GET /app/installations/:id` ve `account.id` karşılaştırması. 0.8 başında karar, ADR-0002'ye yazılacak.
  - Compose henüz `.env`'i ve `secrets/`'i servislere geçirmiyor; 0.7'de eklenecek. Kurulum şu an "All repositories" ile; en az yetki için "Only select repositories" daha doğru.
